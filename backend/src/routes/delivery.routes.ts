import { Router, Response } from 'express';
import { authenticate, authorize, authorizeAny, AuthRequest } from '../middleware/auth';
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
import { dayRangeFromInput } from '../utils/date';
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
/** Drivers may advance or complete assigned deliveries; completion is shared with admin. */
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
    },
    select: {
      id: true,
      allowedModules: true,
      role: {
        select: {
          name: true,
          permissions: { select: { permission: { select: { module: true } } } },
        },
      },
    },
  });
  if (!driver) throw new AppError('Selected delivery person was not found or is inactive', 400);

  const modules = Array.isArray(driver.allowedModules)
    ? (driver.allowedModules as string[])
    : [];
  const roleModules = driver.role.permissions.map((p) => p.permission.module);
  const canDeliver =
    driver.role.name === 'Driver' ||
    modules.includes('delivery') ||
    roleModules.includes('delivery');

  if (!canDeliver) {
    throw new AppError(
      'Selected delivery person must be a Driver or have delivery module access',
      400
    );
  }
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
    const candidates = await prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        allowedModules: true,
        role: {
          select: {
            name: true,
            permissions: { select: { permission: { select: { module: true } } } },
          },
        },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const drivers = candidates.filter((user) => {
      const modules = Array.isArray(user.allowedModules)
        ? (user.allowedModules as string[])
        : [];
      return (
        user.role.name === 'Driver' ||
        modules.includes('delivery') ||
        user.role.permissions.some((p) => p.permission.module === 'delivery')
      );
    });
    res.json({
      success: true,
      data: drivers.map(({ id, firstName, lastName, email }) => ({
        id,
        firstName,
        lastName,
        email,
      })),
    });
  })
);

/** Ready / partially delivered orders with remaining qty — for bulk delivery trips. */
router.get(
  '/ready-orders',
  authorizeAny('delivery:read', 'delivery:create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (isDriverUser(req)) {
      throw new AppError('Drivers cannot list orders for delivery creation', 403);
    }
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const companyId = requireTenantId();

    const where: Prisma.SalesOrderWhereInput = {
      companyId,
      status: { in: ['READY', 'PARTIALLY_DELIVERED'] },
      items: { some: { quantity: { gt: 0 } } },
    };
    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { customer: { name: { contains: search } } },
        { customer: { code: { contains: search } } },
      ];
    }

    const orders = await prisma.salesOrder.findMany({
      where,
      take: 200,
      include: {
        customer: { select: { id: true, name: true, code: true } },
        items: { include: { product: true } },
        salesPerson: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ requiredDate: 'asc' }, { orderDate: 'asc' }],
    });

    const data = orders
      .map((order) => {
        const items = order.items
          .map((item) => {
            const remaining = item.quantity - (item.deliveredQty || 0);
            return remaining > 0
              ? {
                  ...item,
                  remaining,
                }
              : null;
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
        if (items.length === 0) return null;
        return { ...order, items };
      })
      .filter((order): order is NonNullable<typeof order> => order !== null);

    res.json({ success: true, data });
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
    const { page, limit, search, status, date } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
      date?: string;
    }>(req.query);
    const skip = (page - 1) * limit;
    const where: Prisma.DeliveryTripWhereInput = {};
    if (isDriverUser(req)) {
      where.driverId = req.user!.id;
    }
    if (status) where.status = status as Prisma.EnumDeliveryStatusFilter['equals'];
    if (date) {
      const range = dayRangeFromInput(date);
      if (range) {
        where.AND = [
          {
            OR: [
              { scheduledDate: range },
              { scheduledDate: null, createdAt: range },
            ],
          },
        ];
      }
    }
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
    const { status, proofOfDelivery, actualItems, driverId, vehicleId, scheduledDate } = req.body;
    const tripId = getParam(req.params.id);
    const existing = await prisma.deliveryTrip.findUnique({
      where: { id: tripId },
      select: { id: true, driverId: true, status: true, tripNo: true },
    });
    if (!existing) throw new AppError('Delivery trip not found', 404);
    assertDriverTripAccess(req, existing, status);

    if (status === 'ASSIGNED' && !isDriverUser(req)) {
      const nextDriverId = driverId || existing.driverId;
      if (!nextDriverId) {
        throw new AppError('Select a delivery person before assigning', 400);
      }
      if (driverId) await assertActiveDriver(driverId);
    }

    const delivery = await prisma.$transaction(async (tx) =>
      applyDeliveryTripStatus(tx, tripId, status, {
        proofOfDelivery,
        actualItems,
        userId: req.user!.id,
        driverId,
        vehicleId,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      })
    );

    const assignedDriverId = driverId || existing.driverId;
    if (status === 'ASSIGNED' && assignedDriverId && !isDriverUser(req)) {
      const orderNumbers =
        delivery?.stops?.map((stop) => stop.salesOrder.orderNumber).filter(Boolean) || [];
      await NotificationService.notifyDriverDeliveryAssigned({
        driverId: assignedDriverId,
        tripNo: delivery?.tripNo || existing.tripNo,
        orderNumbers,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
      });
    }

    // Notify assigned driver when someone else completes the trip so both sides stay aligned.
    if (
      status === 'DELIVERED' &&
      existing.driverId &&
      existing.driverId !== req.user!.id
    ) {
      await NotificationService.notifyUser(
        existing.driverId,
        'DELIVERY',
        'Delivery completed',
        `Trip ${delivery?.tripNo || ''} was marked delivered. It is complete on your list too.`,
        '/delivery'
      );
    }
    res.json({ success: true, data: delivery });
  })
);

const listDeliveryNotes = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, search, status, date } = getQuery<{
    page: number;
    limit: number;
    search?: string;
    status?: string;
    date?: string;
  }>(req.query);
  const skip = (page - 1) * limit;
  const where: Prisma.DeliveryNoteWhereInput = mergeTenantSalesOrderWhere({
    deliveryTripId: null,
  });
  if (isDriverUser(req)) {
    where.driverId = req.user!.id;
  }
  if (status) where.status = status as Prisma.EnumDeliveryStatusFilter['equals'];
  if (date) {
    const range = dayRangeFromInput(date);
    if (range) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { scheduledDate: range },
            { scheduledDate: null, createdAt: range },
          ],
        },
      ];
    }
  }
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
});

router.get('/', authorize('delivery:read'), validate(deliveryListQuerySchema, 'query'), listDeliveryNotes);
/** Compatibility alias — validation probes used /notes. */
router.get('/notes', authorize('delivery:read'), validate(deliveryListQuerySchema, 'query'), listDeliveryNotes);

router.get(
  '/:id/pdf',
  authorize('delivery:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = getParam(req.params.id);
    const note = await prisma.deliveryNote.findFirst({
      where: { id, companyId: requireTenantId() },
      select: { id: true, deliveryNo: true, driverId: true },
    });
    if (!note) throw new AppError('Delivery not found', 404);
    if (isDriverUser(req) && note.driverId !== req.user!.id) {
      throw new AppError('You can only print deliveries assigned to you', 403);
    }
    const { ExportService } = await import('../services/export.service');
    const delivery = await ExportService.getDeliveryNote(note.id);
    const pdf = await ExportService.generateDeliveryNotePDF(delivery);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${delivery.deliveryNo}.pdf"`);
    res.send(pdf);
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
    const { salesOrderId, vehicleId, driverId, scheduledDate, notes, waybillNo, items, orders } =
      req.body;
    if (driverId) {
      await assertActiveDriver(driverId);
    }
    if (orders?.length) {
      const result = await createMultiOrderDelivery(req.user!.id, {
        vehicleId,
        driverId,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
        notes,
        waybillNo,
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
        waybillNo,
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
    const { status, proofOfDelivery, actualItems, driverId, vehicleId, scheduledDate } = req.body;
    const deliveryId = getParam(req.params.id);
    const existing = await prisma.deliveryNote.findFirst({
      where: { id: deliveryId, salesOrder: { companyId: requireTenantId() } },
      select: {
        id: true,
        driverId: true,
        status: true,
        deliveryNo: true,
        deliveryTripId: true,
        salesOrder: { select: { orderNumber: true } },
      },
    });
    if (!existing) throw new AppError('Delivery not found', 404);
    assertDriverDeliveryAccess(req, existing, status);

    if (status === 'ASSIGNED' && !isDriverUser(req)) {
      const nextDriverId = driverId || existing.driverId;
      if (!nextDriverId) {
        throw new AppError('Select a delivery person before assigning', 400);
      }
      if (driverId) await assertActiveDriver(driverId);
    }

    const delivery = await prisma.$transaction(async (tx) =>
      applyDeliveryNoteStatus(tx, deliveryId, status, {
        proofOfDelivery,
        actualItems,
        userId: req.user!.id,
        driverId,
        vehicleId,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      })
    );

    const assignedDriverId = driverId || existing.driverId;
    if (status === 'ASSIGNED' && assignedDriverId && !isDriverUser(req)) {
      await NotificationService.notifyDriverDeliveryAssigned({
        driverId: assignedDriverId,
        deliveryNo: existing.deliveryNo,
        orderNumbers: [existing.salesOrder.orderNumber],
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
      });
    }

    if (
      status === 'DELIVERED' &&
      existing.driverId &&
      existing.driverId !== req.user!.id
    ) {
      await NotificationService.notifyUser(
        existing.driverId,
        'DELIVERY',
        'Delivery completed',
        `${existing.deliveryNo} was marked delivered. It is complete on your list too.`,
        '/delivery'
      );
    }
    res.json({ success: true, data: delivery });
  })
);
export default router;
