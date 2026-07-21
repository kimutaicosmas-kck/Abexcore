import prisma from '../src/config/database';
import { generateNumber } from '../src/utils/date';

async function main() {
  const orders = await prisma.productionOrder.findMany({
    where: { status: 'IN_PROGRESS' },
    select: { id: true, orderNumber: true },
  });

  for (const order of orders) {
    const existing = await prisma.qualityInspection.findFirst({
      where: { productionOrderId: order.id },
    });
    if (existing) {
      console.log(`${order.orderNumber}: already has ${existing.inspectionNo} (${existing.status})`);
      continue;
    }

    const inspection = await prisma.qualityInspection.create({
      data: {
        inspectionNo: generateNumber('QC', (await prisma.qualityInspection.count()) + 1),
        type: 'production',
        productionOrderId: order.id,
        status: 'PENDING',
      },
    });
    console.log(`${order.orderNumber}: created ${inspection.inspectionNo}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
