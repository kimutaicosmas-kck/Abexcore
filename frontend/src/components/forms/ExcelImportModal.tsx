import { useRef, useState } from 'react';
import { FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button, Alert } from '../ui';
import { downloadFile } from '../../utils/download';
import api from '../../services/api';

export type ExcelImportEntity = 'products' | 'customers' | 'materials' | 'suppliers' | 'employees';

export interface ExcelImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

const ENTITY_CONFIG: Record<
  ExcelImportEntity,
  { title: string; templatePath: string; templateName: string; importPath: string }
> = {
  products: {
    title: 'Import products',
    templatePath: '/products/import/template',
    templateName: 'products-import-template.xlsx',
    importPath: '/products/import',
  },
  customers: {
    title: 'Import customers',
    templatePath: '/customers/import/template',
    templateName: 'customers-import-template.xlsx',
    importPath: '/customers/import',
  },
  materials: {
    title: 'Import materials',
    templatePath: '/inventory/materials/import/template',
    templateName: 'materials-import-template.xlsx',
    importPath: '/inventory/materials/import',
  },
  suppliers: {
    title: 'Import suppliers',
    templatePath: '/inventory/suppliers/import/template',
    templateName: 'suppliers-import-template.xlsx',
    importPath: '/inventory/suppliers/import',
  },
  employees: {
    title: 'Import employees',
    templatePath: '/hr/employees/import/template',
    templateName: 'employees-import-template.xlsx',
    importPath: '/hr/employees/import',
  },
};

interface ExcelImportModalProps {
  open: boolean;
  onClose: () => void;
  entity: ExcelImportEntity;
  onSuccess?: (result: ExcelImportResult) => void;
}

export function ExcelImportModal({ open, onClose, entity, onSuccess }: ExcelImportModalProps) {
  const config = ENTITY_CONFIG[entity];
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExcelImportResult | null>(null);

  const reset = () => {
    setFile(null);
    setError('');
    setResult(null);
    setLoading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const downloadTemplate = async () => {
    setDownloading(true);
    setError('');
    try {
      await downloadFile(config.templatePath, config.templateName);
    } catch {
      setError('Could not download the template. Check your connection and try again.');
    } finally {
      setDownloading(false);
    }
  };

  const runImport = async () => {
    if (!file) {
      setError('Choose an Excel file (.xlsx) to upload.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post(config.importPath, form);
      const data = res.data.data as ExcelImportResult;
      setResult(data);
      onSuccess?.(data);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Import failed. Check the file format and try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={config.title}
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={handleClose}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button onClick={runImport} loading={loading} disabled={!file}>
              <Upload className="h-4 w-4 mr-1.5" />
              Upload & import
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900">Download template</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                loading={downloading}
                onClick={downloadTemplate}
              >
                <Download className="h-4 w-4 mr-1.5" />
                Download Excel template
              </Button>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <p className="font-medium text-slate-900">Upload file</p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setResult(null);
                setError('');
              }}
            />
            {file && (
              <p className="mt-2 text-xs text-slate-500">
                Selected: <span className="font-medium text-slate-700">{file.name}</span>
              </p>
            )}
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {result && (
          <div className="space-y-3">
            <Alert variant={result.errors.length ? 'warning' : 'success'}>
              <div className="flex items-start gap-2">
                {result.errors.length ? (
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="font-medium">
                    Created {result.created}, updated {result.updated}
                    {result.skipped ? `, skipped ${result.skipped}` : ''}
                  </p>
                  {result.errors.length === 0 && (
                    <p className="text-sm mt-0.5">All rows imported successfully.</p>
                  )}
                </div>
              </div>
            </Alert>
            {result.errors.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-lg border border-amber-100 bg-amber-50/50 p-3 text-sm">
                <p className="font-medium text-amber-900 mb-2">Row issues</p>
                <ul className="space-y-1 text-amber-800">
                  {result.errors.slice(0, 40).map((e, i) => (
                    <li key={`${e.row}-${i}`}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                  {result.errors.length > 40 && (
                    <li>…and {result.errors.length - 40} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
