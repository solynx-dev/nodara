import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { exportData, type ExportFormat } from '@/lib/account';
import { useCircles } from '@/lib/queries';
import { useMe, useSession } from '@/lib/session';
import { retentionLabel } from '@/lib/format';
import { C } from '@/lib/theme';
import type { Me } from '@/lib/types';
import { Row, Section, useToast } from '@/components/ui';

const RETENTION = [null, 30, 90, 180, 365, 730, 1825] as const;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const RANGES: { label: string; detail: string; from: () => Date }[] = [
  { label: 'Last hour', detail: 'Everything from the past 60 minutes', from: () => new Date(Date.now() - 3_600_000) },
  { label: 'Today', detail: 'Since midnight', from: startOfToday },
  { label: 'Last 7 days', detail: 'The past week', from: () => new Date(Date.now() - 7 * 86_400_000) },
  { label: 'Last 30 days', detail: 'The past month', from: () => new Date(Date.now() - 30 * 86_400_000) },
  { label: 'All history', detail: 'Every location and trip ever recorded', from: () => new Date(0) },
];

const EXPORTS: { format: ExportFormat; title: string; detail: string }[] = [
  { format: 'json', title: 'Everything (JSON)', detail: 'Profile, circles, places, trips and every point' },
  { format: 'gpx', title: 'Track (GPX)', detail: 'For mapping and fitness apps' },
  { format: 'csv', title: 'Spreadsheet (CSV)', detail: 'For Numbers or Excel' },
  { format: 'geojson', title: 'Map data (GeoJSON)', detail: 'For QGIS, geojson.io…' },
];

/** How long your history is kept, deleting some of it, and taking a copy. */
export default function Privacy() {
  const me = useMe();
  const { config, setMe } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: circles = [] } = useCircles();
  const retention = me.preferences.retentionDays;
  const serverDefault = config?.defaultRetentionDays ?? null;

  const setRetention = async (days: number | null) => {
    try {
      setMe(await api.patch<Me>('/api/me', { preferences: { retentionDays: days } }));
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', body: (e as Error).message });
    }
  };

  const del = (r: (typeof RANGES)[number]) =>
    Alert.alert(`Delete ${r.label.toLowerCase()}?`, 'Locations and trips in this time are removed for good, for you and your circles.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await api.del<{ deleted: number }>(`/api/history/points?from=${encodeURIComponent(r.from().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`);
            qc.invalidateQueries({ queryKey: ['trips'] });
            qc.invalidateQueries({ queryKey: ['timeline'] });
            toast({ tone: 'success', title: `Deleted ${res.deleted.toLocaleString()} locations` });
          } catch (e) {
            toast({ tone: 'error', title: 'Could not delete', body: (e as Error).message });
          }
        },
      },
    ]);

  const exportAs = (f: ExportFormat) => exportData(f).catch((e: Error) => toast({ tone: 'error', title: 'Export failed', body: e.message }));

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: C.groupedBackground }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 60 }}>
      <Section title="Keep my location history" footer="Older locations and trips are deleted automatically, and you get a notification when that happens. Export first if you want a copy.">
        {RETENTION.map((d, i) => (
          <Row
            key={String(d)}
            title={d == null ? `${serverDefault ? `Server default (${retentionLabel(serverDefault)})` : 'Forever'}` : retentionLabel(d)}
            onPress={() => void setRetention(d)}
            accessory={(retention ?? null) === d ? <SymbolView name="checkmark" size={17} weight="semibold" tintColor={C.accent} /> : <View />}
            last={i === RETENTION.length - 1}
          />
        ))}
      </Section>

      <Section title="Who can see your history" footer="People in a circle see your history and trips only from when you joined it, and only if the circle allows it. Owners and admins choose that in each circle's settings.">
        {circles.length ? (
          circles.map((c, i) => (
            <Row
              key={c.id}
              left={
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.color, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                  <Text style={{ color: 'white', fontWeight: '800', fontSize: 14 }}>{c.name.trim()[0]?.toUpperCase()}</Text>
                </View>
              }
              title={c.name}
              subtitle={!c.sharing ? 'Not sharing with this circle' : `History ${c.settings.historyVisible ? 'visible' : 'hidden'} · trips ${c.settings.tripsVisible ? 'visible' : 'hidden'}`}
              onPress={() => router.push(`/circle/${c.id}`)}
              last={i === circles.length - 1}
            />
          ))
        ) : (
          <Row title="You're not in any circles yet" last />
        )}
      </Section>

      <Section title="Delete history" footer="Removes your locations and trips in that time from the server. It can't be undone.">
        {RANGES.map((r, i) => (
          <Row key={r.label} icon="trash.fill" iconColor="#FF3B30" title={r.label} subtitle={r.detail} onPress={() => del(r)} last={i === RANGES.length - 1} />
        ))}
      </Section>

      <Section title="Export your data" footer="Your data belongs to you. Exports open the share sheet, so you can save them to Files or send them anywhere.">
        {EXPORTS.map((e, i) => (
          <Row key={e.format} icon="square.and.arrow.up.fill" iconColor="#30B0C7" title={e.title} subtitle={e.detail} onPress={() => void exportAs(e.format)} last={i === EXPORTS.length - 1} />
        ))}
      </Section>
    </ScrollView>
  );
}
