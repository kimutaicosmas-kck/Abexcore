/**
 * Removes duplicate manual sales invoices when an order also has a delivery invoice.
 * Keeps the delivery-linked invoice (or the one with payments if only one has payments).
 */
import prisma from '../src/config/database';

type SalesInvoice = {
  id: string;
  invoiceNumber: string;
  totalAmount: unknown;
  paidAmount: unknown;
  deliveryNoteId: string | null;
  customerId: string | null;
  payments: { id: string }[];
};

function pickInvoiceToKeep(invoices: SalesInvoice[]): SalesInvoice {
  const withPayments = invoices.filter((inv) => Number(inv.paidAmount) > 0 || inv.payments.length > 0);
  if (withPayments.length === 1) return withPayments[0];
  if (withPayments.length > 1) {
    return withPayments.sort((a, b) => Number(b.paidAmount) - Number(a.paidAmount))[0];
  }
  const deliveryLinked = invoices.find((inv) => inv.deliveryNoteId);
  if (deliveryLinked) return deliveryLinked;
  return invoices[0];
}

async function removeDuplicateInvoice(invoiceId: string) {
  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true, mpesaTransactions: true },
    });
    if (!invoice) return;

    for (const payment of invoice.payments) {
      await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } });
      await tx.bankStatementLine.updateMany({ where: { paymentId: payment.id }, data: { paymentId: null } });
      await tx.mpesaTransaction.updateMany({ where: { paymentId: payment.id }, data: { paymentId: null } });
      await tx.payment.delete({ where: { id: payment.id } });
    }

    await tx.mpesaTransaction.deleteMany({ where: { invoiceId: invoice.id } });
    await tx.paymentAllocation.deleteMany({ where: { invoiceId: invoice.id } });
    await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
    await tx.invoice.delete({ where: { id: invoice.id } });
  });
}

async function movePaymentsToInvoice(fromId: string, toId: string) {
  await prisma.$transaction(async (tx) => {
    const [from, to] = await Promise.all([
      tx.invoice.findUnique({ where: { id: fromId }, include: { payments: true } }),
      tx.invoice.findUnique({ where: { id: toId } }),
    ]);
    if (!from || !to || from.payments.length === 0) return;

    let paidTotal = Number(to.paidAmount);
    for (const payment of from.payments) {
      await tx.payment.update({ where: { id: payment.id }, data: { invoiceId: toId } });
      paidTotal += Number(payment.amount);
    }

    const total = Number(to.totalAmount);
    const status = paidTotal >= total - 0.01 ? 'PAID' : paidTotal > 0 ? 'PARTIAL' : 'UNPAID';
    await tx.invoice.update({
      where: { id: toId },
      data: { paidAmount: paidTotal, status },
    });
    await tx.invoice.update({
      where: { id: fromId },
      data: { paidAmount: 0, status: 'UNPAID' },
    });
  });
}

async function main() {
  const orders = await prisma.salesOrder.findMany({
    where: {
      invoices: { some: { type: 'SALES' } },
    },
    include: {
      invoices: {
        where: { type: 'SALES' },
        include: { payments: { select: { id: true } } },
      },
    },
  });

  const cleaned: string[] = [];

  for (const order of orders) {
    const invoices = order.invoices as SalesInvoice[];
    if (invoices.length < 2) continue;

    const invoicedTotal = invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
    const orderTotal = Number(order.totalAmount);
    if (invoicedTotal <= orderTotal + 0.01) continue;

    const keep = pickInvoiceToKeep(invoices);
    const duplicates = invoices.filter((inv) => inv.id !== keep.id);

    for (const dup of duplicates) {
      const dupHasPayments = Number(dup.paidAmount) > 0 || dup.payments.length > 0;
      const keepHasPayments = Number(keep.paidAmount) > 0 || keep.payments.length > 0;

      if (dupHasPayments && !keepHasPayments) {
        await movePaymentsToInvoice(dup.id, keep.id);
      }

      await removeDuplicateInvoice(dup.id);
      cleaned.push(`${order.orderNumber}: removed ${dup.invoiceNumber}, kept ${keep.invoiceNumber}`);
    }

    if (order.customerId) {
      const { syncCustomerCreditUsed } = await import('../src/utils/credit');
      await syncCustomerCreditUsed(order.customerId);
    }
  }

  if (cleaned.length === 0) {
    console.log('No duplicate sales invoices found.');
  } else {
    console.log('Cleaned duplicate invoices:');
    cleaned.forEach((line) => console.log(`  - ${line}`));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
