import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Navigation, RefreshCw } from 'lucide-react';
import { deliveryApi } from '../../services/api';
import { Button, Card, EmptyState, Badge } from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';
import { useAuth } from '../../contexts/AuthContext';

type FleetVehicle = {
  id: string;
  registration: string;
  type: string;
  make?: string | null;
  model?: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastLocatedAt: string | null;
  activeTrip?: {
    tripNo: string;
    status: string;
    driver?: { firstName: string; lastName: string } | null;
  } | null;
};

/** Live fleet map using OpenStreetMap embeds for last-known GPS fixes. */
export function FleetTrackingPanel() {
  const { hasPermission } = useAuth();
  const canPing = hasPermission('delivery:update') || hasPermission('delivery:create');
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['fleet-live'],
    queryFn: () => deliveryApi.fleetLive().then((r) => (r.data.data || []) as FleetVehicle[]),
    refetchInterval: 30_000,
  });

  const pingMutation = useMutation({
    mutationFn: async (vehicleId: string) => {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation is not supported in this browser'));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
        });
      });
      return deliveryApi.pingVehicleLocation(vehicleId, {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        speedKph: position.coords.speed != null ? position.coords.speed * 3.6 : undefined,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fleet-live'] }),
  });

  const tracked = (data || []).filter((v) => v.lastLat != null && v.lastLng != null);
  const center = tracked[0]
    ? { lat: tracked[0].lastLat!, lng: tracked[0].lastLng! }
    : { lat: -1.286389, lng: 36.817223 };

  const markerQuery = tracked
    .map((v) => `${v.lastLat},${v.lastLng}`)
    .slice(0, 8)
    .join('|');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Live fleet tracking</h3>
          <p className="text-sm text-slate-600">
            Drivers/logistics can ping GPS from the browser. Map refreshes every 30s.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <iframe
          title="Fleet map"
          className="h-80 w-full border-0"
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${center.lng - 0.08}%2C${center.lat - 0.06}%2C${center.lng + 0.08}%2C${center.lat + 0.06}&layer=mapnik&marker=${center.lat}%2C${center.lng}`}
        />
        {markerQuery && (
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            Showing area around latest ping. Open individual map links below for each vehicle.
          </p>
        )}
      </Card>

      {pingMutation.isError && (
        <p className="text-sm text-red-600">{getApiErrorMessage(pingMutation.error)}</p>
      )}

      {isLoading ? (
        <p className="text-slate-500">Loading fleet…</p>
      ) : !(data || []).length ? (
        <EmptyState title="No vehicles" description="Add vehicles under the Vehicles tab first." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(data || []).map((vehicle) => (
            <Card key={vehicle.id} className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900">{vehicle.registration}</div>
                  <div className="text-xs text-slate-500">
                    {vehicle.type}
                    {vehicle.make ? ` · ${vehicle.make}` : ''}
                    {vehicle.model ? ` ${vehicle.model}` : ''}
                  </div>
                </div>
                <Badge variant={vehicle.lastLat != null ? 'success' : 'warning'}>
                  {vehicle.lastLat != null ? 'Tracked' : 'No GPS'}
                </Badge>
              </div>
              {vehicle.activeTrip && (
                <p className="text-xs text-slate-600">
                  Trip {vehicle.activeTrip.tripNo} · {vehicle.activeTrip.status}
                  {vehicle.activeTrip.driver
                    ? ` · ${vehicle.activeTrip.driver.firstName} ${vehicle.activeTrip.driver.lastName}`
                    : ''}
                </p>
              )}
              {vehicle.lastLat != null && vehicle.lastLng != null ? (
                <a
                  className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline"
                  href={`https://www.openstreetmap.org/?mlat=${vehicle.lastLat}&mlon=${vehicle.lastLng}#map=15/${vehicle.lastLat}/${vehicle.lastLng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="h-4 w-4" />
                  {vehicle.lastLat.toFixed(5)}, {vehicle.lastLng.toFixed(5)}
                  {vehicle.lastLocatedAt
                    ? ` · ${new Date(vehicle.lastLocatedAt).toLocaleString()}`
                    : ''}
                </a>
              ) : (
                <p className="text-sm text-slate-500">No location ping yet.</p>
              )}
              {canPing && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pingMutation.isPending}
                  onClick={() => pingMutation.mutate(vehicle.id)}
                >
                  <Navigation className="mr-1 h-4 w-4" />
                  Ping my location
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
