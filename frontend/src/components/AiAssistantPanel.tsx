import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bot, MessageCircle, X } from 'lucide-react';
import { platformApi } from '../services/api';
import { Button, Input } from './ui';
import { useAuth } from '../contexts/AuthContext';
import { getApiErrorMessage } from '../utils/apiError';

type ChatLine = { role: 'user' | 'assistant'; content: string };

export function AiAssistantPanel() {
  const { hasPermission } = useAuth();
  const canUse =
    hasPermission('reports:read') ||
    hasPermission('dashboard:read') ||
    hasPermission('finance:read');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<ChatLine[]>([
    {
      role: 'assistant',
      content: 'Hi — I am your AbexCore business assistant. Ask about sales, AR, stock, payments, or tax.',
    },
  ]);

  const chatMutation = useMutation({
    mutationFn: (text: string) =>
      platformApi.assistantChat({
        message: text,
        history: history.map((h) => ({ role: h.role, content: h.content })),
      }),
    onSuccess: (res, text) => {
      const reply = (res.data.data as { reply: string }).reply;
      setHistory((prev) => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: reply },
      ]);
      setMessage('');
    },
  });

  if (!canUse) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text || chatMutation.isPending) return;
    chatMutation.mutate(text);
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[28rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Bot className="h-4 w-4" /> AI Business Assistant
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {history.map((line, idx) => (
              <div
                key={`${idx}-${line.role}`}
                className={
                  line.role === 'user'
                    ? 'ml-8 rounded-lg bg-primary-50 px-3 py-2 text-sm text-slate-800'
                    : 'mr-6 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700'
                }
              >
                {line.content}
              </div>
            ))}
            {chatMutation.isError && (
              <p className="text-xs text-red-600">{getApiErrorMessage(chatMutation.error)}</p>
            )}
          </div>
          <form onSubmit={onSubmit} className="flex gap-2 border-t border-slate-100 p-3">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask about sales, AR, stock…"
              className="flex-1"
            />
            <Button type="submit" size="sm" disabled={chatMutation.isPending}>
              Send
            </Button>
          </form>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-800"
        aria-label="Open AI assistant"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    </div>
  );
}
