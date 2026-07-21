import { Router, Response } from 'express';

import { authenticate, authorize, AuthRequest } from '../middleware/auth';

import { validate } from '../middleware/validate';

import { asyncHandler, AppError } from '../middleware/errorHandler';

import { auditLog } from '../middleware/auditLog';

import {

  createDeliverySchema,

  updateDeliveryStatusSchema,

  deliveryListQuerySchema,

  createVehicleSchema,

  vehicleListQuerySchema,

  paginationSchema,

} from '../validators/schemas';

import prisma from '../config/database';

import { generateNumber } from '../utils/date';

import { getParam, getQuery } from '../utils/request';

import { DeliveryService } from '../services/operations.service';

import { StockMovementService } from '../services/inventory.service';

import { assertOrderStatusTransition, syncCustomerCreditUsed } from '../utils/credit';

import { FinanceInvoiceService } from '../services/finance.service';

import { SalesOrderService } from '../services/sales-order.service';

import { AccountingService } from '../services/accounting.service';
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

    const existing = await prisma.vehicle.findUnique({ where: { registration: req.body.registration } });

    if (existing) throw new AppError('Vehicle registration already exists', 409);



    const data = await prisma.vehicle.create({ data: req.body });

    res.status(201).json({ success: true, data });

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



    const where: Prisma.DeliveryNoteWhereInput = {};

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

        include: {

          salesOrder: { include: { customer: true } },

          vehicle: true,

          driver: { select: { id: true, firstName: true, lastName: true, email: true } },

          items: true,

        },

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

    const data = await prisma.deliveryNote.findUnique({

      where: { id: getParam(req.params.id) },

      include: {

        salesOrder: {

          include: {

            customer: true,

            items: true,

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

    const { salesOrderId, vehicleId, driverId, scheduledDate, notes, items } = req.body;

    if (driverId) {
      await assertActiveDriver(driverId);
    }

    const count = await prisma.deliveryNote.count();

    const deliveryNo = generateNumber('DN', count + 1);



    const delivery = await prisma.$transaction(async (tx) => {

      const salesOrder = await tx.salesOrder.findUnique({

        where: { id: salesOrderId },

        include: { items: { include: { product: true } } },

      });

      if (!salesOrder) throw new AppError('Sales order not found', 404);



      if (!['READY', 'PARTIALLY_DELIVERED'].includes(salesOrder.status)) {

        throw new AppError('Sales order must be READY or PARTIALLY_DELIVERED before dispatch', 400);

      }



      for (const item of items as { productId: string; quantity: number }[]) {

        const orderItem = salesOrder.items.find((line) => line.productId === item.productId);

        if (!orderItem) {

          throw new AppError(`Product not found on sales order`, 400);

        }



        const remaining = orderItem.quantity - orderItem.deliveredQty;

        if (item.quantity > remaining) {

          throw new AppError(

            `Delivery quantity exceeds remaining (${remaining} left for ${orderItem.product.name})`,

            400

          );

        }

      }



      const dn = await tx.deliveryNote.create({

        data: {

          deliveryNo,

          salesOrderId,

          vehicleId,

          driverId,

          status: vehicleId || driverId ? 'ASSIGNED' : 'PENDING',

          scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,

          notes,

          items: { create: items },

        },

        include: {

          salesOrder: { include: { customer: true } },

          vehicle: true,

          driver: { select: { id: true, firstName: true, lastName: true, email: true } },

          items: true,

        },

      });



      let cogsTotal = 0;

      for (const item of items as { productId: string; quantity: number }[]) {

        const orderItem = salesOrder.items.find((line) => line.productId === item.productId)!;

        const stockBefore = await tx.stockLevel.findFirst({
          where: { productId: item.productId },
          orderBy: { quantity: 'desc' },
        });
        const unitCost = stockBefore ? Number(stockBefore.unitCost) : 0;



        await tx.salesOrderItem.update({

          where: { id: orderItem.id },

          data: { deliveredQty: { increment: item.quantity } },

        });



        await StockMovementService.deductProductStock(tx, {

          productId: item.productId,

          quantity: item.quantity,

          referenceType: 'delivery_note',

          referenceId: dn.id,

          userId: req.user!.id,

          notes: `Dispatch ${deliveryNo}`,

          releaseReservedQty: item.quantity,

        });

        cogsTotal += item.quantity * unitCost;

      }

      await AccountingService.postCostOfGoodsSold(tx, {
        reference: deliveryNo,
        amount: cogsTotal,
      });



      const fullyDelivered = await SalesOrderService.isFullyDelivered(tx, salesOrderId);

      const nextStatus = SalesOrderService.resolveStatusAfterDispatch(salesOrder.status, fullyDelivered);

      assertOrderStatusTransition(salesOrder.status, nextStatus, { system: true });



      await tx.salesOrder.update({

        where: { id: salesOrderId },

        data: { status: nextStatus },

      });



      const invoice = await FinanceInvoiceService.createSalesInvoiceFromDelivery(tx, dn.id);



      return { dn, invoice };

    });



    res.status(201).json({ success: true, data: delivery.dn, invoice: delivery.invoice });

  })

);



router.patch(

  '/:id/status',

  authorize('delivery:update'),

  validate(updateDeliveryStatusSchema),

  auditLog('delivery', 'update', 'delivery_note'),

  asyncHandler(async (req: AuthRequest, res: Response) => {

    const { status, proofOfDelivery } = req.body;

    const deliveryId = getParam(req.params.id);

    const existing = await prisma.deliveryNote.findUnique({

      where: { id: deliveryId },

      select: { id: true, driverId: true, status: true },

    });

    if (!existing) throw new AppError('Delivery not found', 404);

    assertDriverDeliveryAccess(req, existing, status);



    const delivery = await prisma.$transaction(async (tx) => {

      const updated = await tx.deliveryNote.update({

        where: { id: deliveryId },

        data: {

          status,

          proofOfDelivery,

          deliveredAt: status === 'DELIVERED' ? new Date() : undefined,

        },

        include: {

          salesOrder: { include: { customer: true } },

          vehicle: true,

          driver: { select: { id: true, firstName: true, lastName: true, email: true } },

          items: true,

        },

      });



      if (status === 'DELIVERED') {

        const fullyDelivered = await SalesOrderService.isFullyDelivered(tx, updated.salesOrderId);

        if (fullyDelivered) {

          assertOrderStatusTransition(updated.salesOrder.status, 'DELIVERED', { system: true });

          await tx.salesOrder.update({

            where: { id: updated.salesOrderId },

            data: { status: 'DELIVERED' },

          });

        }



        await syncCustomerCreditUsed(updated.salesOrder.customerId, tx);

      }



      return updated;

    });



    res.json({ success: true, data: delivery });

  })

);



export default router;

