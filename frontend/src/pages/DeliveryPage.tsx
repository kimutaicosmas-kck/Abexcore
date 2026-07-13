import { PageHeader, Card } from '../components/ui';
import { Truck } from 'lucide-react';

export function DeliveryPage() {
  return (
    <div>
      <PageHeader title="Delivery Management" subtitle="Delivery notes, routes, drivers, and proof of delivery" />
      <Card>
        <div className="text-center py-12">
          <Truck className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Delivery Module</h3>
          <p className="text-gray-500 mt-2">
            Manage delivery notes, vehicle assignment, driver routes, and proof of delivery.
            Create sales orders to generate deliveries automatically.
          </p>
        </div>
      </Card>
    </div>
  );
}
