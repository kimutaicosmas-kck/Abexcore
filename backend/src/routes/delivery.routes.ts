import { Router, Response } from 'express';

import { authenticate, authorize, AuthRequest } from '../middleware/auth';

import { validate } from '../middleware/validate';

import { asyncHandler, AppError } from '../middleware/errorHandler';

import { auditLog } from '../middleware/auditLog';

import {

  createDeliverySchema,

  updateDeliveryStatusSchema,

  updateDeliveryTripStatusSchema,

  deliveryListQuerySchema,

  createVehicleSchema,

  vehicleListQuerySchema,

} from '../validators/schemas';

import prisma from '../config/database';

import { getParam, getQuery } from '../utils/request';
import { injectTenantData, mergeTenantSalesOrderWhere, requireTenantId } from '../utils/tenant';

import { DeliveryService } from '../services/operations.service';

import {
  applyDeliveryNoteStatus,
  applyDeliveryTripStatus,
  createDeliveryStop,
  createMultiOrderDelivery,
  deliveryStopInclude,
} from '../services/delivery-trip.service';

import { NotificationService } from '../services/notification.service';

import { Prisma } from '@prisma/client';



const router = Router();

router.use(authenticate);

function isDriverUser(req: AuthRequest) {
  return req.user!.roleName === 'Driver';
}

const DRIVER_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  ASSIGNED: ['IN_TRANSIT', 'DELIVERED'],
  IN_TRANSIT: ['DELIVERED'],
};

function assertDriverDeliveryAccess(
  req: AuthRequest,
  delivery: { driverId: string | null; status: string },
  nextStatus: string
) {
  if (!isDriverUser(req)) return;

  if (delivery.driverId !== req.user!.id) {
    throw new AppError('You can only update deliveries assigned to you', 403);
  }

  const allowed = DRIVER_STATUS_TRANSITIONS[delivery.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new AppError(`Drivers cannot change delivery from ${delivery.status} to ${nextStatus}`, 403);
  }
}

function assertDriverTripAccess(
  req: AuthRequest,
  trip: { driverId: string | null; status: string },
  nextStatus: string
) {
  if (!isDriverUser(req)) return;

  if (trip.driverId !== req.user!.id) {
    throw new AppError('You can only update trips assigned to you', 403);
  }

  const allowed = DRIVER_STATUS_TRANSITIONS[trip.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new AppError(`Drivers cannot change trip from ${trip.status} to ${nextStatus}`, 403);
  }
}

async function assertActiveDriver(driverId: string) {
  const driver = await prisma.user.findFirst({
    where: {
      id: driverId,
      deletedAt: null,
      status: 'ACTIVE',
      role: { name: 'Driver' },
    },
    select: { id: true },
  });
  if (!driver) throw new AppError('Selected driver is not active', 400);
}



router.get(

  '/stats',

  authorize('delivery:read'),

  asyncHandler(async (_req: AuthRequest, res: Response) => {

    const data = await DeliveryService.getStats();

    res.json({ success: true, data });

  })

);



router.get(

  '/drivers/list',

  authorize('delivery:read'),

  asyncHandler(async (_req: AuthRequest, res: Response) => {

    const drivers = await prisma.user.findMany({

      where: { deletedAt: null, status: 'ACTIVE', role: { name: 'Driver' } },

      select: { id: true, firstName: true, lastName: true, email: true },

      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],

    });

    res.json({ success: true, data: drivers });

  })

);



router.get(

  '/vehicles',

  authorize('delivery:read'),

  validate(vehicleListQuerySchema, 'query'),

  asyncHandler(async (req: AuthRequest, res: Response) => {

    const { page, limit, search, type } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      type?: 'MOTORCYCLE' | 'TRUCK' | 'LORRY';
    }>(

      req.query

    );

    const skip = (page - 1) * limit;



    const where: Prisma.VehicleWhereInput = { isActive: true };

    if (type) where.type = type;

    if (search) {

      where.OR = [

        { registration: { contains: search } },

        { make: { contains: search } },

        { model: { contains: search } },

      ];

    }



    const [data, total] = await Promise.all([

      prisma.vehicle.findMany({ where, skip, take: limit, orderBy: { registration: 'asc' } }),

      prisma.vehicle.count({ where }),

    ]);



    res.json({

      success: true,

      data,

      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },

    });

  })

);



router.post(

  '/vehicles',

  authorize('delivery:create'),

  validate(createVehicleSchema),

  auditLog('delivery', 'create', 'vehicle'),

  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { registration, type, make, model, capacity, isHired } = req.body;

    const existing = await prisma.vehicle.findFirst({
      where: { registration: String(registration).trim() },
    });

    if (existing) throw new AppError('Vehicle registration already exists', 409);

    const data = await prisma.vehicle.create({
      data: injectTenantData({
        registration: String(registration).trim(),
        type,
        make: make?.trim() || null,
        model: model?.trim() || null,
        capacity: capacity?.trim() || null,
        isHired: Boolean(isHired),
      }),
    });

    res.status(201).json({ success: true, data });

  })

);



router.get(
  '/trips',
  authorize('delivery:read'),
  validate(deliveryListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, status } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.DeliveryTripWhereInput = {};
    if (isDriverUser(req)) {
      where.driverId = req.user!.id;
    }
    if (status) where.status = status as Prisma.EnumDeliveryStatusFilter['equals'];
    if (search) {
      where.OR = [
        { tripNo: { contains: search } },
        { stops: { some: { deliveryNo: { contains: search } } } },
        { stops: { some: { salesOrder: { orderNumber: { contains: search } } } } },
        { stops: { some: { salesOrder: { customer: { name: { contains: search } } } } } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.deliveryTrip.findMany({
        where,
        skip,
        take: limit,
        include: {
          vehicle: true,
          driver: { select: { id: true, firstName: true, lastName: true, email: true } },
          stops: {
            include: deliveryStopInclude,
            orderBy: { stopSequence: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.deliveryTrip.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/trips/:id',
  authorize('delivery:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.deliveryTrip.findUnique({
      where: { id: getParam(req.params.id) },
      include: {
        vehicle: true,
        driver: { select: { id: true, firstName: true, lastName: true, email: true } },
        stops: {
          include: deliveryStopInclude,
          orderBy: { stopSequence: 'asc' },
        },
      },
    });
    if (!data) throw new AppError('Delivery trip not found', 404);
    if (isDriverUser(req) && data.driverId !== req.user!.id) {
      throw new AppError('You can only view trips assigned to you', 403);
    }
    res.json({ success: true, data });
  })
);

router.patch(
  '/trips/:id/status',
  authorize('delivery:update'),
  validate(updateDeliveryTripStatusSchema),
  auditLog('delivery', 'update', 'delivery_trip'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { status, proofOfDelivery, actualItems } = req.body;
    const tripId = getParam(req.params.id);

    const existing = await prisma.deliveryTrip.findUnique({
      where: { id: tripId },
      select: { id: true, driverId: true, status: true },
    });
    if (!existing) throw new AppError('Delivery trip not found', 404);
    assertDriverTripAccess(req, existing, status);

    const delivery = await prisma.$transaction(async (tx) =>
      applyDeliveryTripStatus(tx, tripId, status, {
        proofOfDelivery,
        actualItems,
        userId: req.user!.id,
      })
    );

    res.json({ success: true, data: delivery });
  })
);



router.get(

  '/',

  authorize('delivery:read'),

  validate(deliveryListQuerySchema, 'query'),

  asyncHandler(async (req: AuthRequest, res: Response) => {

    const { page, limit, search, status } = getQuery<{

      page: number;

      limit: number;

      search?: string;

      status?: string;

    }>(req.query);

    const skip = (page - 1) * limit;



    const where: Prisma.DeliveryNoteWhereInput = mergeTenantSalesOrderWhere({
      deliveryTripId: null,
    });

    if (isDriverUser(req)) {
      where.driverId = req.user!.id;
    }

    if (status) where.status = status as Prisma.EnumDeliveryStatusFilter['equals'];

    if (search) {

      where.OR = [

        { deliveryNo: { contains: search } },

        { salesOrder: { orderNumber: { contains: search } } },

        { salesOrder: { customer: { name: { contains: search } } } },

      ];

    }



    const [data, total] = await Promise.all([

      prisma.deliveryNote.findMany({

        where,

        skip,

        take: limit,

        include: deliveryStopInclude,

        orderBy: { createdAt: 'desc' },

      }),

      prisma.deliveryNote.count({ where }),

    ]);



    res.json({

      success: true,

      data,

      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },

    });

  })

);



router.get(

  '/:id',

  authorize('delivery:read'),

  asyncHandler(async (req: AuthRequest, res: Response) => {

    const data = await prisma.deliveryNote.findFirst({

      where: { id: getParam(req.params.id), salesOrder: { companyId: requireTenantId() } },

      include: {

        salesOrder: {

          include: {

            customer: true,

            items: true,

          },

        },

        deliveryTrip: {
          include: {
            vehicle: true,
            driver: { select: { id: true, firstName: true, lastName: true, email: true } },
            stops: {
              include: deliveryStopInclude,
              orderBy: { stopSequence: 'asc' },
            },
          },
        },

        vehicle: true,

        driver: { select: { id: true, firstName: true, lastName: true, email: true } },

        items: true,

      },

    });

    if (!data) throw new AppError('Delivery not found', 404);

    if (isDriverUser(req) && data.driverId !== req.user!.id) {
      throw new AppError('You can only view deliveries assigned to you', 403);
    }

    res.json({ success: true, data });

  })

);



router.post(

  '/',

  authorize('delivery:create'),

  validate(createDeliverySchema),

  auditLog('delivery', 'create', 'delivery_note'),

  asyncHandler(async (req: AuthRequest, res: Response) => {

    if (isDriverUser(req)) {
      throw new AppError('Drivers cannot create delivery notes', 403);
    }

    const { salesOrderId, vehicleId, driverId, scheduledDate, notes, items, orders } = req.body;

    if (driverId) {
      await assertActiveDriver(driverId);
    }

    if (orders?.length) {
      const result = await createMultiOrderDelivery(req.user!.id, {
        vehicleId,
        driverId,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
        notes,
        orders,
      });

      if (driverId) {
        const orderNumbers = result.stops.map((stop) => stop.salesOrder.orderNumber);
        await NotificationService.notifyDriverDeliveryAssigned({
          driverId,
          tripNo: result.trip?.tripNo,
          deliveryNo: result.stops[0]?.deliveryNo,
          orderNumbers,
          scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
        });
      }

      if (result.trip) {
        res.status(201).json({ success: true, data: result.trip, invoices: result.invoices });
        return;
      }

      res.status(201).json({
        success: true,
        data: result.stops[0],
        invoice: result.invoices[0],
      });
      return;
    }

    const delivery = await prisma.$transaction(async (tx) => {
      const result = await createDeliveryStop(tx, {
        salesOrderId,
        items,
        vehicleId,
        driverId,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
        notes,
        userId: req.user!.id,
      });
      return result;
    });

    if (driverId) {
      await NotificationService.notifyDriverDeliveryAssigned({
        driverId,
        deliveryNo: delivery.dn.deliveryNo,
        orderNumbers: [delivery.dn.salesOrder.orderNumber],
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
      });
    }

    res.status(201).json({ success: true, data: delivery.dn, invoice: delivery.invoice });

  })

);



router.patch(

  '/:id/status',

  authorize('delivery:update'),

  validate(updateDeliveryStatusSchema),

  auditLog('delivery', 'update', 'delivery_note'),

  asyncHandler(async (req: AuthRequest, res: Response) => {

    const { status, proofOfDelivery, actualItems } = req.body;

    const deliveryId = getParam(req.params.id);

    const existing = await prisma.deliveryNote.findFirst({

      where: { id: deliveryId, salesOrder: { companyId: requireTenantId() } },

      select: { id: true, driverId: true, status: true },

    });

    if (!existing) throw new AppError('Delivery not found', 404);

    assertDriverDeliveryAccess(req, existing, status);



    const delivery = await prisma.$transaction(async (tx) =>
      applyDeliveryNoteStatus(tx, deliveryId, status, {
        proofOfDelivery,
        actualItems,
        userId: req.user!.id,
      })
    );



    res.json({ success: true, data: delivery });

  })

);



export default router;
