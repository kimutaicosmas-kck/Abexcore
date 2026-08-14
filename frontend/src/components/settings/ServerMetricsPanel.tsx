import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  Activity,
  Cpu,
  Database,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
  Timer,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { systemApi } from '../../services/api';
import { ApiErrorAlert, Button, Card, PageQueryStatus, StatCard, StatGrid } from '../ui';
import type { SystemMetrics } from '../../types';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 ms';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(ms >= 100 ? 0 : 1)} ms`;
}

function UsageBar({ percent, tone }: { percent: number; tone: 'cpu' | 'memory' | 'disk' }) {
  const color =
    tone === 'cpu'
      ? percent >= 85
        ? 'bg-red-500'
        : percent >= 65
          ? 'bg-amber-500'
          : 'bg-emerald-500'
      : tone === 'memory'
        ? percent >= 90
          ? 'bg-red-500'
          : percent >= 75
            ? 'bg-amber-500'
            : 'bg-sky-500'
        : percent >= 90
          ? 'bg-red-500'
          : percent >= 80
            ? 'bg-amber-500'
            : 'bg-violet-500';

  return (
    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

function MetricTile({
  label,
  value,
  meta,
  bar,
}: {
  label: string;
  value: string;
  meta?: string;
  bar?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-primary-100 bg-white p-4 shadow-soft space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-900 tabular-nums">{value}</p>
      {bar}
      {meta && <p className="text-xs text-slate-500">{meta}</p>}
    </div>
  );
}

export function ServerMetricsPanel() {
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['system-metrics'],
    queryFn: () => systemApi.metrics().then((r) => r.data.data as SystemMetrics),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  if (isLoading && !data) {
    return (
      <Card title="Server performance">
        <div className="py-10 text-center text-sm text-slate-500">Loading server metrics…</div>
      </Card>
    );
  }

  if (isError && !data) {
    return (
      <div className="space-y-4">
        <PageQueryStatus isError={isError} error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data) return null;

  const cpuDisplay = data.host.cpuUsagePercent != null ? `${data.host.cpuUsagePercent}%` : 'Sampling…';
  const memoryMeta = `${formatBytes(data.memory.usedBytes)} used · ${formatBytes(data.memory.freeBytes)} free`;
  const diskMeta = data.disk
    ? `${formatBytes(data.disk.usedBytes)} used · ${formatBytes(data.disk.freeBytes)} free`
    : 'Disk stats unavailable';

  const mysqlConnected = data.mysql.threadsConnected;
  const mysqlMax = data.mysql.maxConnections;
  const redisMem = data.redis.usedMemoryBytes;
  const redisLabel = !data.redis.configured
    ? 'Not configured'
    : !data.redis.connected
      ? 'Disconnected'
      : data.redis.usedMemoryHuman || (redisMem != null ? formatBytes(redisMem) : '—');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Server className="h-5 w-5 text-primary-600" />
            Server performance
          </h2>
        </div>
        <Button variant="secondary" size="sm" loading={isFetching} onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      {isError && <ApiErrorAlert error={error} onRetry={() => refetch()} compact />}

      <StatGrid>
        <StatCard
          dense
          title="CPU usage"
          value={cpuDisplay}
          icon={<Cpu className="h-5 w-5 text-white" />}
          color="from-emerald-500 to-emerald-700"
        />
        <StatCard
          dense
          title="Memory used"
          value={`${data.memory.usedPercent}%`}
          icon={<MemoryStick className="h-5 w-5 text-white" />}
          color="from-sky-500 to-sky-700"
        />
        <StatCard
          dense
          title="Disk used"
          value={data.disk ? `${data.disk.usedPercent}%` : '—'}
          icon={<HardDrive className="h-5 w-5 text-white" />}
          color="from-violet-500 to-violet-700"
        />
        <StatCard
          dense
          title="Server uptime"
          value={formatUptime(data.host.uptimeSeconds)}
          icon={<Activity className="h-5 w-5 text-white" />}
          color="from-orange-500 to-orange-700"
        />
        <StatCard
          dense
          title="MySQL connections"
          value={mysqlConnected != null ? String(mysqlConnected) : '—'}
          icon={<Database className="h-5 w-5 text-white" />}
          color="from-cyan-500 to-cyan-700"
        />
        <StatCard
          dense
          title="Redis memory"
          value={redisLabel}
          icon={<MemoryStick className="h-5 w-5 text-white" />}
          color="from-rose-500 to-rose-700"
        />
        <StatCard
          dense
          title="Queue length"
          value={data.queue.configured ? String(data.queue.waiting + data.queue.active) : '—'}
          icon={<Layers className="h-5 w-5 text-white" />}
          color="from-indigo-500 to-indigo-700"
        />
        <StatCard
          dense
          title="API p95"
          value={data.api.sampleCount ? formatMs(data.api.p95Ms) : 'Sampling…'}
          icon={<Timer className="h-5 w-5 text-white" />}
          color="from-teal-500 to-teal-700"
        />
        <StatCard
          dense
          title="Failed jobs"
          value={data.queue.configured ? String(data.queue.failed) : '—'}
          icon={<AlertTriangle className="h-5 w-5 text-white" />}
          color="from-amber-500 to-amber-700"
        />
        <StatCard
          dense
          title="Worker crashes"
          value={data.process.workerCrashes != null ? String(data.process.workerCrashes) : '—'}
          icon={<AlertTriangle className="h-5 w-5 text-white" />}
          color="from-red-500 to-red-700"
        />
      </StatGrid>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricTile
          label="CPU"
          value={cpuDisplay}
          meta={`${data.host.cpuCount} cores · load ${data.host.loadAverage.load1.toFixed(2)} / ${data.host.loadAverage.load5.toFixed(2)} / ${data.host.loadAverage.load15.toFixed(2)}`}
          bar={<UsageBar percent={data.host.cpuUsagePercent ?? 0} tone="cpu" />}
        />
        <MetricTile
          label="Memory (RAM)"
          value={`${data.memory.usedPercent}%`}
          meta={memoryMeta}
          bar={<UsageBar percent={data.memory.usedPercent} tone="memory" />}
        />
        <MetricTile
          label="Disk"
          value={data.disk ? `${data.disk.usedPercent}%` : '—'}
          meta={diskMeta}
          bar={data.disk ? <UsageBar percent={data.disk.usedPercent} tone="disk" /> : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Host">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Hostname</dt>
              <dd className="font-medium text-slate-900 break-all">{data.host.hostname}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Platform</dt>
              <dd className="font-medium text-slate-900">{data.host.platform}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Processor</dt>
              <dd className="font-medium text-slate-900">{data.host.cpuModel}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Metrics scope</dt>
              <dd className="font-medium text-slate-900 capitalize">{data.scope}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Total RAM</dt>
              <dd className="font-medium text-slate-900">{formatBytes(data.memory.totalBytes)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Total disk</dt>
              <dd className="font-medium text-slate-900">
                {data.disk ? formatBytes(data.disk.totalBytes) : '—'}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="AbexCore API process">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Node.js</dt>
              <dd className="font-medium text-slate-900">{data.runtime.nodeVersion}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Environment</dt>
              <dd className="font-medium text-slate-900">{data.runtime.environment}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Cluster workers</dt>
              <dd className="font-medium text-slate-900">{data.process.clusterWorkers}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Worker crashes</dt>
              <dd className="font-medium text-slate-900">
                {data.process.workerCrashes != null ? data.process.workerCrashes : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Process uptime</dt>
              <dd className="font-medium text-slate-900">{formatUptime(data.process.uptimeSeconds)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">RSS memory</dt>
              <dd className="font-medium text-slate-900">{formatBytes(data.process.memory.rssBytes)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Heap used</dt>
              <dd className="font-medium text-slate-900">{formatBytes(data.process.memory.heapUsedBytes)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="MySQL">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Threads connected</dt>
              <dd className="font-medium text-slate-900 tabular-nums">
                {mysqlConnected != null ? mysqlConnected : '—'}
                {mysqlMax != null ? ` / ${mysqlMax}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Threads running</dt>
              <dd className="font-medium text-slate-900 tabular-nums">
                {data.mysql.threadsRunning != null ? data.mysql.threadsRunning : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">App pool limit</dt>
              <dd className="font-medium text-slate-900 tabular-nums">{data.mysql.poolLimit}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Redis">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd className="font-medium text-slate-900">
                {!data.redis.configured
                  ? 'Not configured'
                  : data.redis.connected
                    ? 'Connected'
                    : 'Disconnected'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Used memory</dt>
              <dd className="font-medium text-slate-900">
                {data.redis.usedMemoryHuman ||
                  (data.redis.usedMemoryBytes != null ? formatBytes(data.redis.usedMemoryBytes) : '—')}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Peak memory</dt>
              <dd className="font-medium text-slate-900">
                {data.redis.usedMemoryPeakBytes != null
                  ? formatBytes(data.redis.usedMemoryPeakBytes)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Max memory</dt>
              <dd className="font-medium text-slate-900">
                {data.redis.maxMemoryBytes != null ? formatBytes(data.redis.maxMemoryBytes) : '—'}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Job queue">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Waiting</dt>
              <dd className="font-medium text-slate-900 tabular-nums">
                {data.queue.configured ? data.queue.waiting : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Active</dt>
              <dd className="font-medium text-slate-900 tabular-nums">
                {data.queue.configured ? data.queue.active : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Failed</dt>
              <dd className="font-medium text-slate-900 tabular-nums">
                {data.queue.configured ? data.queue.failed : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd className="font-medium text-slate-900">
                {!data.queue.configured
                  ? 'Not configured'
                  : data.queue.connected
                    ? 'Connected'
                    : 'Disconnected'}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="API response time">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Avg</dt>
              <dd className="font-medium text-slate-900 tabular-nums">{formatMs(data.api.avgMs)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">p50</dt>
              <dd className="font-medium text-slate-900 tabular-nums">{formatMs(data.api.p50Ms)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">p95</dt>
              <dd className="font-medium text-slate-900 tabular-nums">{formatMs(data.api.p95Ms)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">p99</dt>
              <dd className="font-medium text-slate-900 tabular-nums">{formatMs(data.api.p99Ms)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Max</dt>
              <dd className="font-medium text-slate-900 tabular-nums">{formatMs(data.api.maxMs)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Requests / 5xx</dt>
              <dd className="font-medium text-slate-900 tabular-nums">
                {data.api.requestCount} / {data.api.errorCount}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Recent failed jobs">
          {!data.queue.configured ? (
            <p className="text-sm text-slate-500">Set REDIS_URL to enable the job queue.</p>
          ) : data.queue.recentFailed.length === 0 ? (
            <p className="text-sm text-slate-500">No failed jobs recorded.</p>
          ) : (
            <ul className="space-y-2 text-sm max-h-48 overflow-auto">
              {data.queue.recentFailed.map((job) => (
                <li key={job.id} className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2">
                  <p className="font-medium text-slate-900">{job.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {new Date(job.failedAt).toLocaleString()} · {job.error}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
