import { DeliveryStatus, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { nextDeliveryNoteNumber, nextDeliveryTripNumber } from '../utils/numbering';
import { assertOrderStatusTransition, syncCustomerCreditUsed } from '../utils/credit';
import { StockMovementService } from './inventory.service';
import { FinanceInvoiceService } from './finance.service';
import { SalesOrderService } from './sales-order.service';
import { AccountingService } from './accounting.service';

type TxClient = Prisma.TransactionClient;

export type DeliveryItemInput = { productId: string; quantity: number };
export type ActualDeliveryItemInput = { productId: string; quantity: number };

async function reconcileDeliveryActualQuantities(
  tx: TxClient,
  deliveryId: string,
  userId: string,
  actualItems?: ActualDeliveryItemInput[]
) {
  if (!actualItems?.length) return;

  const delivery = await tx.deliveryNote.findUnique({
    where: { id: deliveryId },
    include: {
      items: true,
      salesOrder: { include: { items: true } },
    },
  });
  if (!delivery) throw new AppError('Delivery not found', 404);

  let adjusted = false;

  for (const item of delivery.items) {
    const actualEntry = actualItems.find((a) => a.productId === item.productId);
    const actualQty = actualEntry?.quantity ?? item.quantity;

    if (actualQty > item.quantity) {
      throw new AppError(
        `Delivered quantity (${actualQty}) cannot exceed dispatched quantity (${item.quantity})`,
        400
      );
    }

    if (actualQty === item.quantity) continue;

    const shortfall = item.quantity - actualQty;
    const orderItem = delivery.salesOrder.items.find((line) => line.productId === item.productId);
    if (!orderItem) continue;

    await tx.deliveryItem.update({
      where: { id: item.id },
      data: { quantity: actualQty },
    });

    await tx.salesOrderItem.update({
      where: { id: orderItem.id },
      data: { deliveredQty: { decrement: shortfall } },
    });

    await StockMovementService.addProductStock(tx, {
      productId: item.productId,
      quantity: shortfall,
      referenceType: 'delivery_shortfall',
      referenceId: deliveryId,
      userId,
      notes: `${shortfall} unit(s) not accepted on ${delivery.deliveryNo} — returned to stock`,
    });
    adjusted = true;
  }

  // Confirm-delivered always sends actualItems; only rewrite the invoice when qty changed.
  // Recalculating on a paid invoice was incorrectly returning 400 for full deliveries.
  if (adjusted) {
    await FinanceInvoiceService.recalculateDeliveryInvoice(tx, deliveryId);
  }
}

export type CreateStopInput = {
  salesOrderId: string;
  items: DeliveryItemInput[];
  vehicleId?: string;
  driverId?: string;
  scheduledDate?: Date;
  notes?: string;
  waybillNo?: string;
  deliveryTripId?: string;
  stopSequence?: number;
  userId: string;
};

const STOP_INCLUDE = {
  salesOrder: { include: { customer: true } },
  vehicle: true,
  driver: { select: { id: true, firstName: true, lastName: true, email: true } },
  items: true,
  deliveryTrip: { select: { id: true, tripNo: true, status: true, waybillNo: true } },
} as const;

type DeliveryStopNote = Prisma.DeliveryNoteGetPayload<{ include: typeof STOP_INCLUDE }>;

function resolveInitialStatus(vehicleId?: string, driverId?: string): DeliveryStatus {
  return vehicleId || driverId ? 'ASSIGNED' : 'PENDING';
}

export async function createDeliveryStop(
  tx: TxClient,
  input: CreateStopInput
): Promise<{ dn: DeliveryStopNote; invoice: Awaited<ReturnType<typeof FinanceInvoiceService.createSalesInvoiceFromDelivery>> }> {
  const {
    salesOrderId,
    items,
    vehicleId,
    driverId,
    scheduledDate,
    notes,
    waybillNo,
    deliveryTripId,
    stopSequence,
    userId,
  } = input;

  const salesOrder = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: { items: { include: { product: true } } },
  });
  if (!salesOrder) throw new AppError('Sales order not found', 404);

  if (!['READY', 'PARTIALLY_DELIVERED'].includes(salesOrder.status)) {
    throw new AppError('Sales order must be READY or PARTIALLY_DELIVERED before dispatch', 400);
  }

  for (const item of items) {
    const orderItem = salesOrder.items.find((line) => line.productId === item.productId);
    if (!orderItem) {
      throw new AppError('Product not found on sales order', 400);
    }

    const remaining = orderItem.quantity - orderItem.deliveredQty;
    if (item.quantity > remaining) {
      throw new AppError(
        `Delivery quantity exceeds remaining (${remaining} left for ${orderItem.product.name})`,
        400
      );
    }
  }

  const deliveryNo = await nextDeliveryNoteNumber(tx);
  const status = resolveInitialStatus(vehicleId, driverId);

  const dn = await tx.deliveryNote.create({
    data: {
      companyId: salesOrder.companyId,
      deliveryNo,
      salesOrderId,
      deliveryTripId,
      stopSequence,
      vehicleId,
      driverId,
      waybillNo: waybillNo?.trim() || null,
      status,
      scheduledDate,
      notes,
      items: { create: items },
    },
    include: STOP_INCLUDE,
  });

  let cogsTotal = 0;
  for (const item of items) {
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
      userId,
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

  await SalesOrderService.syncOrderDeliveryStatus(tx, salesOrderId);

  const invoice = await FinanceInvoiceService.createSalesInvoiceFromDelivery(tx, dn.id);

  return { dn, invoice };
}

export async function syncDeliveryTripStatus(tx: TxClient, tripId: string) {
  const stops = await tx.deliveryNote.findMany({
    where: { deliveryTripId: tripId },
    select: { status: true },
  });
  if (stops.length === 0) return;

  const statuses = stops.map((s) => s.status);
  const open = statuses.filter((s) => !['DELIVERED', 'FAILED', 'RETURNED'].includes(s));
  let tripStatus: DeliveryStatus = 'PENDING';

  if (statuses.every((s) => s === 'DELIVERED')) {
    // Entire trip complete — same status for admin and assigned driver.
    tripStatus = 'DELIVERED';
  } else if (open.length === 0 && statuses.some((s) => s === 'FAILED')) {
    tripStatus = 'FAILED';
  } else if (open.length === 0 && statuses.some((s) => s === 'RETURNED')) {
    tripStatus = 'RETURNED';
  } else if (statuses.some((s) => s === 'IN_TRANSIT') || statuses.some((s) => s === 'DELIVERED')) {
    // Partial progress (some delivered, others still open) stays in transit.
    tripStatus = 'IN_TRANSIT';
  } else if (statuses.some((s) => s === 'ASSIGNED')) {
    tripStatus = 'ASSIGNED';
  }

  await tx.deliveryTrip.update({
    where: { id: tripId },
    data: { status: tripStatus },
  });
}

export async function applyDeliveryNoteStatus(
  tx: TxClient,
  deliveryId: string,
  status: DeliveryStatus,
  options?: {
    proofOfDelivery?: string;
    actualItems?: ActualDeliveryItemInput[];
    userId?: string;
    driverId?: string | null;
    vehicleId?: string | null;
    scheduledDate?: Date | null;
    /** When cascading from trip status, skip per-stop trip sync (caller syncs once). */
    skipTripSync?: boolean;
  }
) {
  const proofOfDelivery = options?.proofOfDelivery;
  const actualItems = options?.actualItems;
  const userId = options?.userId;

  if (status === 'DELIVERED' && actualItems?.length && userId) {
    await reconcileDeliveryActualQuantities(tx, deliveryId, userId, actualItems);
  }

  const assignment: {
    driverId?: string | null;
    vehicleId?: string | null;
    scheduledDate?: Date | null;
  } = {};
  if (options?.driverId !== undefined) assignment.driverId = options.driverId;
  if (options?.vehicleId !== undefined) assignment.vehicleId = options.vehicleId;
  if (options?.scheduledDate !== undefined) assignment.scheduledDate = options.scheduledDate;

  const updated = await tx.deliveryNote.update({
    where: { id: deliveryId },
    data: {
      status,
      proofOfDelivery,
      deliveredAt: status === 'DELIVERED' ? new Date() : undefined,
      ...assignment,
    },
    include: STOP_INCLUDE,
  });

  // Keep trip + stop driver assignment in sync so both admin and driver lists match.
  if (updated.deliveryTripId && options?.driverId) {
    const trip = await tx.deliveryTrip.findUnique({
      where: { id: updated.deliveryTripId },
      select: { driverId: true },
    });
    if (trip && !trip.driverId) {
      await tx.deliveryTrip.update({
        where: { id: updated.deliveryTripId },
        data: { driverId: options.driverId },
      });
    }
  }

  if (status === 'DELIVERED') {
    await SalesOrderService.syncOrderDeliveryStatus(tx, updated.salesOrderId);
    await syncCustomerCreditUsed(updated.salesOrder.customerId, tx);
  }

  if (updated.deliveryTripId && !options?.skipTripSync) {
    await syncDeliveryTripStatus(tx, updated.deliveryTripId);
  }

  return updated;
}

export async function applyDeliveryTripStatus(
  tx: TxClient,
  tripId: string,
  status: DeliveryStatus,
  options?: {
    proofOfDelivery?: string;
    actualItems?: { deliveryNoteId: string; items: ActualDeliveryItemInput[] }[];
    userId?: string;
    driverId?: string | null;
    vehicleId?: string | null;
    scheduledDate?: Date | null;
  }
) {
  const proofOfDelivery = options?.proofOfDelivery;
  const actualItemsByStop = options?.actualItems;
  const userId = options?.userId;

  const trip = await tx.deliveryTrip.findUnique({
    where: { id: tripId },
    include: { stops: { select: { id: true, status: true } } },
  });
  if (!trip) throw new AppError('Delivery trip not found', 404);

  const tripAssignment: {
    driverId?: string | null;
    vehicleId?: string | null;
    scheduledDate?: Date | null;
  } = {};
  if (options?.driverId !== undefined) tripAssignment.driverId = options.driverId;
  if (options?.vehicleId !== undefined) tripAssignment.vehicleId = options.vehicleId;
  if (options?.scheduledDate !== undefined) tripAssignment.scheduledDate = options.scheduledDate;
  if (Object.keys(tripAssignment).length > 0) {
    await tx.deliveryTrip.update({
      where: { id: tripId },
      data: tripAssignment,
    });
  }

  // Stops are the source of truth — update them first, then derive trip status.
  // Completing a trip must complete every open stop so admin and driver always match.
  const hasAssignmentUpdate =
    options?.driverId !== undefined ||
    options?.vehicleId !== undefined ||
    options?.scheduledDate !== undefined;

  // Propagate trip driver onto stops that have none, so driver "My Deliveries" matches.
  if (options?.driverId) {
    await tx.deliveryNote.updateMany({
      where: {
        deliveryTripId: tripId,
        OR: [{ driverId: null }, { driverId: { not: options.driverId } }],
        status: { notIn: ['DELIVERED', 'FAILED', 'RETURNED'] },
      },
      data: { driverId: options.driverId },
    });
  }

  for (const stop of trip.stops) {
    if (status === 'DELIVERED') {
      if (['DELIVERED', 'FAILED', 'RETURNED'].includes(stop.status)) continue;
    } else if (status === 'IN_TRANSIT') {
      if (!['ASSIGNED', 'PENDING', 'IN_TRANSIT'].includes(stop.status)) continue;
    } else if (status === 'ASSIGNED') {
      if (!['PENDING', 'ASSIGNED'].includes(stop.status)) continue;
    }

    // Skip only when status already matches and no driver/vehicle reassignment.
    if (stop.status === status && !hasAssignmentUpdate) continue;

    await applyDeliveryNoteStatus(tx, stop.id, status, {
      proofOfDelivery,
      actualItems: actualItemsByStop?.find((entry) => entry.deliveryNoteId === stop.id)?.items,
      userId,
      driverId: options?.driverId,
      vehicleId: options?.vehicleId,
      scheduledDate: options?.scheduledDate,
      skipTripSync: true,
    });
  }

  await syncDeliveryTripStatus(tx, tripId);

  // Explicit trip completion: if every stop that can be delivered is delivered, lock trip as DELIVERED.
  if (status === 'DELIVERED') {
    const remaining = await tx.deliveryNote.count({
      where: {
        deliveryTripId: tripId,
        status: { notIn: ['DELIVERED', 'FAILED', 'RETURNED'] },
      },
    });
    if (remaining === 0) {
      await tx.deliveryTrip.update({
        where: { id: tripId },
        data: { status: 'DELIVERED' },
      });
    }
  }

  return tx.deliveryTrip.findUnique({
    where: { id: tripId },
    include: {
      vehicle: true,
      driver: { select: { id: true, firstName: true, lastName: true, email: true } },
      stops: { include: STOP_INCLUDE, orderBy: { stopSequence: 'asc' } },
    },
  });
}

export async function createMultiOrderDelivery(
  userId: string,
  input: {
    vehicleId?: string;
    driverId?: string;
    scheduledDate?: Date;
    notes?: string;
    waybillNo?: string;
    orders: { salesOrderId: string; items: DeliveryItemInput[] }[];
  }
) {
  if (input.orders.length === 0) {
    throw new AppError('Add at least one order to the delivery', 400);
  }

  const orderIds = input.orders.map((o) => o.salesOrderId);
  if (new Set(orderIds).size !== orderIds.length) {
    throw new AppError('Each sales order can only appear once on a delivery trip', 400);
  }

  return prisma.$transaction(async (tx) => {
    const scheduledDate = input.scheduledDate;
    const initialStatus = resolveInitialStatus(input.vehicleId, input.driverId);

    let trip: Awaited<ReturnType<typeof tx.deliveryTrip.create>> | null = null;
    if (input.orders.length > 1) {
      const anchorOrder = await tx.salesOrder.findUnique({
        where: { id: input.orders[0].salesOrderId },
        select: { companyId: true },
      });
      if (!anchorOrder) throw new AppError('Sales order not found', 404);

      trip = await tx.deliveryTrip.create({
        data: {
          companyId: anchorOrder.companyId,
          tripNo: await nextDeliveryTripNumber(tx, anchorOrder.companyId),
          vehicleId: input.vehicleId,
          driverId: input.driverId,
          waybillNo: input.waybillNo?.trim() || null,
          status: initialStatus,
          scheduledDate,
          notes: input.notes,
        },
      });
    }

    const stops: Awaited<ReturnType<typeof createDeliveryStop>>[] = [];
    for (let i = 0; i < input.orders.length; i++) {
      const order = input.orders[i];
      const result = await createDeliveryStop(tx, {
        salesOrderId: order.salesOrderId,
        items: order.items,
        vehicleId: input.vehicleId,
        driverId: input.driverId,
        scheduledDate,
        notes: input.notes,
        waybillNo: input.waybillNo,
        deliveryTripId: trip?.id,
        stopSequence: trip ? i + 1 : undefined,
        userId,
      });
      stops.push(result);
    }

    const tripWithStops = trip
      ? await tx.deliveryTrip.findUnique({
          where: { id: trip.id },
          include: {
            vehicle: true,
            driver: { select: { id: true, firstName: true, lastName: true, email: true } },
            stops: { include: STOP_INCLUDE, orderBy: { stopSequence: 'asc' } },
          },
        })
      : null;

    return {
      trip: tripWithStops,
      stops: stops.map((s) => s.dn),
      invoices: stops.map((s) => s.invoice),
    };
  });
}

export const deliveryStopInclude = STOP_INCLUDE;
