import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

type TxClient = Prisma.TransactionClient;

export class ProcurementService {
  static async applyGoodsReceiptToPurchaseOrder(
    tx: TxClient,
    purchaseOrderId: string,
    receiptItems: { rawMaterialId?: string | null; quantity: number }[]
  ) {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { items: true },
    });
    if (!po) return;

    for (const receiptItem of receiptItems) {
      const poItem = po.items.find((item) => item.rawMaterialId === receiptItem.rawMaterialId);
      if (!poItem) {
        throw new AppError(`Receipt item does not match any purchase order line`, 400);
      }

      const receivedQty = Number(poItem.receivedQty) + receiptItem.quantity;
      if (receivedQty > Number(poItem.quantity) + 0.001) {
        throw new AppError(
          `Receipt exceeds PO quantity for ${poItem.description}`,
          400
        );
      }

      await tx.purchaseOrderItem.update({
        where: { id: poItem.id },
        data: { receivedQty },
      });
    }

    const updatedItems = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId },
    });
    const fullyReceived = updatedItems.every(
      (item) => Number(item.receivedQty) >= Number(item.quantity)
    );

    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: fullyReceived ? 'COMPLETED' : 'CONFIRMED' },
    });
  }
}
