import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Card from '@/components/ui/Card';
import IconTile from '@/components/ui/IconTile';
import Tabs from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { availabilityErrorKey, isScheduleDirty, scheduleFromAvailability, toBlockBody, toScheduleBody, validateSchedule } from '../availabilityForm';
import BlockDatesPanel from '../components/BlockDatesPanel';
import WeekCalendar from '../components/WeekCalendar';
import WeeklyScheduleEditor from '../components/WeeklyScheduleEditor';
import * as api from '../services/availabilityApi';

/** /doctor/availability — weekly schedule, blocked dates and the published-slot calendar. */
export default function AvailabilityPage() {
  const { t } = useI18n();
  const notify = useToast();
  const [tab, setTab] = useState('weekly');
  const [data, setData] = useState(null);
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyBlock, setBusyBlock] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const apply = useCallback((next) => {
    const schedule = scheduleFromAvailability(next);
    setData(next);
    setSaved(schedule);
    setForm(schedule);
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    api
      .getMyAvailability()
      .then(apply)
      .catch(() => setLoadError(true));
  }, [apply]);

  // Once errors are shown, re-check as the doctor edits so messages clear as soon as times are fixed.
  const showingErrors = Object.keys(errors).length > 0;
  useEffect(() => {
    if (showingErrors && form) setErrors(validateSchedule(form));
  }, [form, showingErrors]);

  const dirty = useMemo(() => !!form && !!saved && isScheduleDirty(form, saved), [form, saved]);
  const canManage = !!data?.canManage;
  const slotSummary = (slots) => (slots ? t('availability.slotsChanged', { created: slots.created, removed: slots.removed }) : '');

  const save = async () => {
    const found = validateSchedule(form);
    setErrors(found);
    if (Object.keys(found).length) return notify(t('availability.fixErrors'), 'error');
    setSaving(true);
    try {
      const next = await api.saveSchedule(toScheduleBody(form));
      apply(next);
      notify(`${t('availability.saved')} ${slotSummary(next.slots)}`);
    } catch (error) {
      notify(t(availabilityErrorKey(error)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const addBlock = async (blockForm) => {
    try {
      const next = await api.addBlock(toBlockBody(blockForm, data.timeZone));
      apply(next);
      notify(`${t('availability.blockAdded')} ${next.keptBooked ? t('availability.keptBooked', { count: next.keptBooked }) : ''}`.trim());
      return true;
    } catch (error) {
      notify(t(availabilityErrorKey(error)), 'error');
      return false;
    }
  };

  const removeBlock = async (block) => {
    setBusyBlock(block.id);
    try {
      apply(await api.removeBlock(block.id));
      notify(t('availability.blockRemoved'));
    } catch (error) {
      notify(t(availabilityErrorKey(error)), 'error');
    } finally {
      setBusyBlock(null);
    }
  };

  return (
    <>
      <PageHeader title={t('availability.title')} subtitle={t('availability.subtitle')} back="/doctor" />

      {loadError ? (
        <Card className="p-6 text-sm text-muted">{t('availability.loadError')}</Card>
      ) : !form ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true">
          <div className="card h-[32rem] animate-pulse" />
          <div className="card h-80 animate-pulse" />
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
            {!canManage && (
              <Card className="flex items-start gap-4 p-5" role="note">
                <IconTile icon={ShieldAlert} tone="gold" />
                <div>
                  <p className="font-bold">{t('availability.lockedTitle')}</p>
                  <p className="mt-1 text-sm text-muted">{t('availability.lockedBody')}</p>
                </div>
              </Card>
            )}
            <Card className="p-5 sm:p-6">
              <Tabs
                items={[
                  { value: 'weekly', label: t('availability.tabWeekly') },
                  { value: 'blocks', label: t('availability.tabBlocks') },
                ]}
                value={tab}
                onChange={setTab}
                className="mb-5 max-w-sm"
              />
              {tab === 'weekly' ? (
                <WeeklyScheduleEditor
                  form={form}
                  onChange={setForm}
                  errors={errors}
                  disabled={!canManage}
                  saving={saving}
                  dirty={dirty}
                  onSave={save}
                />
              ) : (
                <BlockDatesPanel blocks={data.blocks} timeZone={data.timeZone} disabled={!canManage} onAdd={addBlock} onRemove={removeBlock} busyId={busyBlock} />
              )}
            </Card>
          </div>
          <WeekCalendar timeZone={data.timeZone} refreshKey={refreshKey} />
        </div>
      )}
    </>
  );
}
