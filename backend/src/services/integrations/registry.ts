import { listCircuitBreakers } from '../../utils/circuitBreaker';
import { MpesaService } from '../mpesa.service';
import { EmailService } from '../email.service';

export type IntegrationStatus = {
  name: string;
  available: boolean;
  mode: 'live' | 'stub' | 'disabled';
  circuit?: ReturnType<typeof listCircuitBreakers>[number];
};

/**
 * Integration module registry — isolates external services so failures stay bounded.
 * Each integration can fail independently without taking down core ERP routes.
 */
export class IntegrationRegistry {
  static getStatuses(): IntegrationStatus[] {
    const circuits = new Map(listCircuitBreakers().map((row) => [row.name.toLowerCase(), row]));

    return [
      {
        name: 'mpesa',
        available: MpesaService.isConfigured(),
        mode: MpesaService.isLive() ? 'live' : MpesaService.isConfigured() ? 'stub' : 'disabled',
        circuit: circuits.get('mpesa'),
      },
      {
        name: 'email',
        available: EmailService.isConfigured(),
        mode: EmailService.isConfigured() ? 'live' : 'disabled',
        circuit: circuits.get('email'),
      },
      {
        name: 'database',
        available: true,
        mode: 'live',
      },
    ];
  }

  static isIntegrationOpen(name: string): boolean {
    const circuit = listCircuitBreakers().find(
      (row) => row.name.toLowerCase() === name.toLowerCase() && row.state === 'open'
    );
    return !!circuit;
  }
}
