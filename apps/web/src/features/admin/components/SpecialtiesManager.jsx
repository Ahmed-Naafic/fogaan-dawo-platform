import { useState } from 'react';
import { Plus } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { apiRequest } from '@/lib/apiClient';
import { useLoad } from '@/features/finance/financeUi';

const api = {
  list: () => apiRequest('/v1/admin/specialties'),
  create: (body) => apiRequest('/v1/admin/specialties', { method: 'POST', body }),
  update: (id, body) => apiRequest(`/v1/admin/specialties/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
};

/**
 * Requirement 1: the specialty list doctors choose from is managed by administrators. Add a specialty
 * (English + Somali name), rename it, or deactivate it (hidden from new applications and search filters;
 * doctors who already have it keep it). Nothing is deleted.
 */
export default function SpecialtiesManager() {
  const { t } = useI18n();
  const notify = useToast();
  const state = useLoad(() => api.list(), []);
  const [form, setForm] = useState({ nameEn: '', nameSo: '' });
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn, okKey) => {
    setBusy(true);
    try {
      await fn();
      notify(t(okKey), 'success');
      state.reload();
      return true;
    } catch (error) {
      notify(t(error?.code === 'SPECIALTY_EXISTS' ? 'specialties.exists' : 'specialties.failed'), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (form.nameEn.trim().length < 2 || form.nameSo.trim().length < 2) return notify(t('specialties.namesRequired'), 'error');
    if (await run(() => api.create({ nameEn: form.nameEn.trim(), nameSo: form.nameSo.trim() }), 'specialties.added')) setForm({ nameEn: '', nameSo: '' });
  };

  return (
    <Card className="p-5 sm:p-6" data-specialties-manager>
      <CardHeader title={t('specialties.title')} subtitle={t('specialties.subtitle')} />
      <ul className="divide-y divide-line">
        {(state.data?.items ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5" data-specialty={s.id}>
            {editing?.id === s.id ? (
              <form
                className="flex flex-1 flex-wrap gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await run(() => api.update(s.id, { nameEn: editing.nameEn.trim(), nameSo: editing.nameSo.trim() }), 'specialties.saved')) setEditing(null);
                }}
              >
                <Input className="min-w-[10rem] flex-1" value={editing.nameEn} onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })} aria-label={t('specialties.nameEn')} />
                <Input className="min-w-[10rem] flex-1" value={editing.nameSo} onChange={(e) => setEditing({ ...editing, nameSo: e.target.value })} aria-label={t('specialties.nameSo')} />
                <Button type="submit" size="sm" disabled={busy}>
                  {t('specialties.save')}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>
                  {t('common.cancel')}
                </Button>
              </form>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {s.nameEn} <span className="font-normal text-muted">· {s.nameSo}</span>
                  </p>
                  <p className="text-2xs text-muted">{t('specialties.doctors', { count: s.doctors })}</p>
                </div>
                {!s.isActive && <Badge tone="neutral">{t('specialties.inactive')}</Badge>}
                <Button size="sm" variant="secondary" onClick={() => setEditing({ id: s.id, nameEn: s.nameEn, nameSo: s.nameSo })}>
                  {t('specialties.rename')}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => api.update(s.id, { isActive: !s.isActive }), s.isActive ? 'specialties.deactivated' : 'specialties.activated')}>
                  {t(s.isActive ? 'specialties.deactivate' : 'specialties.activate')}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <Input className="min-w-[10rem] flex-1" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} placeholder={t('specialties.nameEn')} aria-label={t('specialties.nameEn')} maxLength={120} />
        <Input className="min-w-[10rem] flex-1" value={form.nameSo} onChange={(e) => setForm({ ...form, nameSo: e.target.value })} placeholder={t('specialties.nameSo')} aria-label={t('specialties.nameSo')} maxLength={120} />
        <Button type="submit" disabled={busy}>
          <Plus className="h-4 w-4" /> {t('specialties.add')}
        </Button>
      </form>
    </Card>
  );
}
