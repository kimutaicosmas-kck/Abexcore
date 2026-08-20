import { config } from '../config';
import { AnalyticsService } from './analytics.service';
import { AppError } from '../middleware/errorHandler';

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

/**
 * AI Business Assistant — grounded on live ERP KPIs.
 * Uses OpenAI-compatible API when OPENAI_API_KEY is set; otherwise rule-based answers.
 */
export class AssistantService {
  static isLlmConfigured(): boolean {
    return Boolean(config.ai.apiKey);
  }

  static async chat(input: { message: string; history?: ChatMessage[] }) {
    const message = input.message?.trim();
    if (!message) throw new AppError('Message is required', 400);

    const summary = await AnalyticsService.executiveSummary();
    const aging = await AnalyticsService.arAging();
    const context = {
      kpis: summary.kpis,
      period: summary.period,
      arAging: aging,
    };

    if (this.isLlmConfigured()) {
      try {
        const answer = await this.callLlm(message, input.history || [], context);
        return { reply: answer, mode: 'llm' as const, context };
      } catch {
        // fall through to rules
      }
    }

    return {
      reply: this.ruleBasedReply(message, context),
      mode: 'rules' as const,
      context,
    };
  }

  private static ruleBasedReply(
    message: string,
    context: {
      kpis: {
        salesOrdersMonth: number;
        salesAmountMonth: number;
        salesTodayAmount: number;
        salesTodayCount: number;
        arOutstanding: number;
        openInvoiceCount: number;
        overdueInvoiceCount: number;
        collectionsMonth: number;
        paymentCountMonth: number;
        lowStockSkuCount: number;
        pendingApprovals: number;
        fiscalPendingInvoices: number;
      };
      period: { from: Date; to: Date };
      arAging: unknown;
    }
  ): string {
    const q = message.toLowerCase();
    const k = context.kpis;

    if (/sales|revenue|turnover|today/.test(q)) {
      return (
        `Sales this period: KES ${Number(k.salesAmountMonth || 0).toLocaleString()} ` +
        `across ${k.salesOrdersMonth || 0} orders. ` +
        `Today: KES ${Number(k.salesTodayAmount || 0).toLocaleString()} (${k.salesTodayCount || 0} orders).`
      );
    }
    if (/receivable|outstanding|ar|debtor|overdue/.test(q)) {
      return (
        `Accounts receivable outstanding: KES ${Number(k.arOutstanding || 0).toLocaleString()}. ` +
        `Open invoices: ${k.openInvoiceCount || 0}, overdue: ${k.overdueInvoiceCount || 0}.`
      );
    }
    if (/stock|inventory|low stock|sku/.test(q)) {
      return `Low-stock SKUs: ${k.lowStockSkuCount || 0}. Review Inventory → Low Stock for replenishment.`;
    }
    if (/payment|cash|collected|receipt/.test(q)) {
      return (
        `Payments collected this period: KES ${Number(k.collectionsMonth || 0).toLocaleString()} ` +
        `(${k.paymentCountMonth || 0} receipts).`
      );
    }
    if (/approv|pending|workflow/.test(q)) {
      return `Pending approvals: ${k.pendingApprovals || 0}. Open Approvals to clear the inbox.`;
    }
    if (/etims|tax|fiscal|kra/.test(q)) {
      return `Sales invoices awaiting / failed eTIMS fiscalization: ${k.fiscalPendingInvoices || 0}.`;
    }
    if (/help|what can|capabilities/.test(q)) {
      return (
        'I can answer questions about sales, receivables, payments, low stock, approvals, and tax/eTIMS status. ' +
        'Ask e.g. “How are sales today?” or “What is outstanding AR?”'
      );
    }

    return (
      `Here’s a quick snapshot — Sales period KES ${Number(k.salesAmountMonth || 0).toLocaleString()}, ` +
      `AR KES ${Number(k.arOutstanding || 0).toLocaleString()}, ` +
      `low stock ${k.lowStockSkuCount || 0}, pending approvals ${k.pendingApprovals || 0}. ` +
      `Ask about sales, receivables, stock, payments, approvals, or tax.`
    );
  }

  private static async callLlm(
    message: string,
    history: ChatMessage[],
    context: unknown
  ): Promise<string> {
    const baseUrl = (config.ai.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const system = [
      'You are the AbexCore ERP AI Business Assistant for a Kenyan manufacturing/trading company.',
      'Answer briefly using only the provided KPI context. Currency is KES unless stated otherwise.',
      'If data is missing, say so. Do not invent figures.',
      `Live context JSON: ${JSON.stringify(context)}`,
    ].join('\n');

    const messages = [
      { role: 'system', content: system },
      ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages,
        temperature: 0.2,
        max_tokens: 500,
      }),
    });

    if (!res.ok) {
      throw new AppError(`AI provider error (${res.status})`, 502);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AppError('Empty AI response', 502);
    return text;
  }
}
