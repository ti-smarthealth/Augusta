/**
 * Fixture backend, for running the app with no Cognito session and no network.
 *
 * Enabled by `EXPO_PUBLIC_MOCK=1` in a dev build — see `MOCK` in
 * `constants/config.ts`, which also gates it on `__DEV__` so it cannot reach a
 * release build.
 *
 * Why this exists: 12 of the app's 15 routes need a session, which made them
 * unreachable to any automated accessibility scan, to CI, and to UI work
 * offline. The admin dashboard already solved the same problem the same way
 * (`VITE_MOCK=1`, `dashboard/src/lib/mock.ts`); this is that pattern applied to
 * the app.
 *
 * Writes mutate the arrays below rather than no-op'ing, because every form in
 * the app refetches after saving — a no-op save looks identical to a broken
 * one, which would make the forms useless to exercise. Nothing persists across
 * a reload, which is the intended behaviour: every run starts from the same
 * fixtures, so a scan is reproducible.
 */
import type { MealTimes } from './meal-alarms';

const iso = (daysFromNow: number, hour = 9, minute = 0) => {
  // Relative to a fixed base so a fixture never silently ages into the past and
  // changes which branch a screen renders. Deliberately not Date.now().
  const base = new Date('2026-08-24T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + daysFromNow);
  base.setUTCHours(hour, minute, 0, 0);
  return base.toISOString();
};

export const MOCK_USER = {
  id: 101,
  username: 'demo',
  email: 'demo@mock.local',
  role: 'civilian',
  full_name: 'Chen Mei-Ling',
  phone_number: '+886912345678',
  birth_date: '1948-03-11',
  gender_id: 2,
  condition_id: 1,
};

const dependents = [
  { id: 202, username: 'a-kong', email: 'akong@mock.local', role: 'civilian', full_name: 'Chen A-Kong', relationship_type: 'parent' },
  { id: 203, username: 'siu-mei', email: 'siumei@mock.local', role: 'civilian', full_name: 'Chen Siu-Mei', relationship_type: 'child' },
];

const appointmentStatuses = [
  { id: 1, label: 'New', color: '#6366F1' },
  { id: 2, label: 'Cancelled', color: '#EF4444' },
  { id: 3, label: 'Rescheduled', color: '#F59E0B' },
  { id: 4, label: 'Completed', color: '#22C55E' },
];

let appointments = [
  // status_label 'New' drives Home's hero check-in card — keep at least one.
  { id: 1, user_id: 101, appointment_date: iso(1, 10, 30), doctor_name: 'Dr Lin Wei', title: 'Cardiology follow-up', hospital: 'Taipei Veterans General', department: 'Cardiology', room_number: '3F-12', appointment_number: 'A-2291', details: 'Bring the last ECG printout.', status_id: 1, status_label: 'New', status_color: '#6366F1' },
  { id: 2, user_id: 101, appointment_date: iso(9, 14, 0), doctor_name: 'Dr Huang Ya-Ting', title: 'Diabetes review', hospital: 'NTU Hospital', department: 'Endocrinology', room_number: '2F-04', appointment_number: 'A-2310', details: '', status_id: 1, status_label: 'New', status_color: '#6366F1' },
  { id: 3, user_id: 101, appointment_date: iso(-14, 9, 0), doctor_name: 'Dr Wu Cheng', title: 'Annual physical', hospital: 'Cathay General', department: 'Family Medicine', room_number: '1F-08', appointment_number: 'A-2140', details: '', status_id: 4, status_label: 'Completed', status_color: '#22C55E' },
];

let medicationLibrary = [
  { id: 1, name: 'Metformin', default_dosage: '500mg' },
  { id: 2, name: 'Amlodipine', default_dosage: '5mg' },
  { id: 3, name: 'Atorvastatin', default_dosage: '20mg' },
  { id: 4, name: 'Levothyroxine', default_dosage: '50mcg' },
];

let medicationReminders = [
  { id: 1, user_id: 101, med_id: 1, med_name: 'Metformin', selected_dosage: '500mg', frequency_days: 1, status: 'active', at_breakfast: true, at_lunch: false, at_dinner: true, at_bedtime: false, breakfast_timing: 'after', dinner_timing: 'after', lunch_timing: 'none', alarms: ['08:30', '19:00'], alarm_labels: ['After breakfast', 'After dinner'], alarm_sources: ['meal', 'meal'], escalation_enabled: true, escalation_delay_minutes: 30, burst_count: 3, snooze_minutes: 10 },
  { id: 2, user_id: 101, med_id: 2, med_name: 'Amlodipine', selected_dosage: '5mg', frequency_days: 1, status: 'active', at_breakfast: true, at_lunch: false, at_dinner: false, at_bedtime: false, breakfast_timing: 'before', lunch_timing: 'none', dinner_timing: 'none', alarms: ['07:45'], alarm_labels: ['Before breakfast'], alarm_sources: ['meal'], escalation_enabled: false, escalation_delay_minutes: 30, burst_count: 1, snooze_minutes: 10 },
  { id: 3, user_id: 101, med_id: 3, med_name: 'Atorvastatin', selected_dosage: '20mg', frequency_days: 1, status: 'inactive', at_breakfast: false, at_lunch: false, at_dinner: false, at_bedtime: true, breakfast_timing: 'none', lunch_timing: 'none', dinner_timing: 'none', alarms: ['22:00'], alarm_labels: ['Bedtime'], alarm_sources: ['meal'], escalation_enabled: false, escalation_delay_minutes: 30, burst_count: 1, snooze_minutes: 10 },
];

// One unconfirmed dose in the past, so the medications screen renders its
// missed-dose section rather than the empty state.
const medicationDoses = [
  { id: 11, reminder_id: 1, user_id: 101, scheduled_for: iso(-2, 19, 0), confirmed_at: null, confirmed_by: null, snoozed_until: null, snooze_count: 0, med_name: 'Metformin', selected_dosage: '500mg' },
  { id: 12, reminder_id: 1, user_id: 101, scheduled_for: iso(-1, 8, 30), confirmed_at: iso(-1, 8, 41), confirmed_by: 101, snoozed_until: null, snooze_count: 0, med_name: 'Metformin', selected_dosage: '500mg' },
];

const testConfig = [
  { field_number: 1, display_name: 'Fasting glucose', units: 'mmol/L' },
  { field_number: 2, display_name: 'HbA1c', units: '%' },
  { field_number: 3, display_name: 'Total cholesterol', units: 'mmol/L' },
  { field_number: 4, display_name: 'Systolic BP', units: 'mmHg' },
];

let testResults = [
  { id: 1, user_id: 101, test_date: iso(-60, 8, 0), field_1: '7.4', field_2: '6.9', field_3: '5.1', field_4: '138' },
  { id: 2, user_id: 101, test_date: iso(-30, 8, 0), field_1: '6.8', field_2: '6.5', field_3: '4.8', field_4: '132' },
  { id: 3, user_id: 101, test_date: iso(-3, 8, 0), field_1: '6.1', field_2: '6.2', field_3: '4.6', field_4: '127' },
];

const announcements = [
  { id: 1, title_en: 'Clinic closed Monday', title_zh_hant: '週一休診', content_en: 'The cardiology clinic is closed on Monday for maintenance. Existing appointments have been moved.', content_zh_hant: '心臟科門診週一因維護休診，已預約者將另行安排時間。', published_at: iso(-2, 9, 0), type_label_en: 'Notice', type_label_zh_hant: '公告', type_color: '#6366F1' },
  { id: 2, title_en: 'Flu vaccinations now available', title_zh_hant: '流感疫苗開放接種', content_en: 'Seasonal flu vaccination is available without an appointment for patients over 65.', content_zh_hant: '65歲以上長者可不需預約，直接前往接種季節性流感疫苗。', published_at: iso(-9, 9, 0), type_label_en: 'Health', type_label_zh_hant: '健康資訊', type_color: '#22C55E' },
];

let mealTimes: MealTimes = { breakfast_time: '08:00', lunch_time: '12:30', dinner_time: '18:30', bedtime_time: '22:00' };

const genders = [{ id: 1, name: 'Male' }, { id: 2, name: 'Female' }, { id: 3, name: 'Prefer not to say' }];
const conditions = [{ id: 1, name: 'Type 2 diabetes' }, { id: 2, name: 'Hypertension' }, { id: 3, name: 'None' }];

const relationshipsGranted = [
  { id: 1, dependent_id: 202, full_name: 'Chen A-Kong', relationship_type: 'parent', status: 'active', granted_at: iso(-120, 9, 0) },
];
const relationshipsPending = [
  { id: 2, requester_id: 303, full_name: 'Lee Chia-Hao', relationship_type: 'child', status: 'pending', requested_at: iso(-4, 9, 0) },
];

const nextId = (rows: { id: number }[]) => (rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1);

/** Strips the query string and any `?user_id=` the caller appended. */
function routeOf(endpoint: string) {
  const noQuery = endpoint.split('?')[0];
  return noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
}

function resolve(route: string, method: string, body: any): { status: number; payload: unknown } {
  const ok = (payload: unknown = { message: 'ok' }) => ({ status: 200, payload });

  switch (route) {
    case '/me':
      return ok(MOCK_USER);
    case '/my-dependents':
      return ok(dependents);
    case '/genders':
      return ok(genders);
    case '/conditions':
      return ok(conditions);
    case '/appointment-statuses':
      return ok(appointmentStatuses);
    case '/test-config':
      return ok(testConfig);
    case '/announcements':
      return ok(announcements);
    case '/medication-doses':
      return ok(medicationDoses);
    case '/relationships/granted':
      return ok(relationshipsGranted);
    case '/relationships/pending':
      return ok(relationshipsPending);
    case '/relationships/request':
    case '/relationships/respond':
    case '/relationships/revoke':
    case '/push-tokens':
    case '/register-profile':
    case '/telemetry':
      return ok();

    case '/meal-times':
      if (method === 'PUT' || method === 'POST') { mealTimes = { ...mealTimes, ...body }; return ok(mealTimes); }
      return ok(mealTimes);

    case '/appointments': {
      if (method === 'POST') {
        const status = appointmentStatuses.find((s) => s.id === body?.status_id) ?? appointmentStatuses[0];
        const row = { ...body, id: nextId(appointments), user_id: MOCK_USER.id, status_label: status.label, status_color: status.color };
        appointments = [...appointments, row];
        return ok(row);
      }
      if (method === 'PUT') {
        appointments = appointments.map((a) => {
          if (a.id !== body?.id) return a;
          const status = appointmentStatuses.find((s) => s.id === (body.status_id ?? a.status_id)) ?? appointmentStatuses[0];
          return { ...a, ...body, status_label: status.label, status_color: status.color };
        });
        return ok();
      }
      if (method === 'DELETE') { appointments = appointments.filter((a) => a.id !== body?.id); return ok(); }
      return ok(appointments);
    }

    case '/medication-reminders': {
      if (method === 'POST') {
        const med = medicationLibrary.find((m) => m.id === body?.med_id);
        const row = { ...body, id: nextId(medicationReminders), user_id: MOCK_USER.id, med_name: med?.name ?? 'Unknown', status: body?.status ?? 'active' };
        medicationReminders = [...medicationReminders, row];
        return ok(row);
      }
      if (method === 'PUT') {
        medicationReminders = medicationReminders.map((r) => (r.id === body?.id ? { ...r, ...body } : r));
        return ok();
      }
      if (method === 'DELETE') { medicationReminders = medicationReminders.filter((r) => r.id !== body?.id); return ok(); }
      return ok(medicationReminders);
    }

    case '/medication-library': {
      if (method === 'POST') {
        const row = { id: nextId(medicationLibrary), name: body?.name, default_dosage: body?.default_dosage };
        medicationLibrary = [...medicationLibrary, row];
        return ok(row);
      }
      return ok(medicationLibrary);
    }

    case '/test-results': {
      if (method === 'POST') {
        const row = { ...body, id: nextId(testResults), user_id: MOCK_USER.id };
        testResults = [...testResults, row];
        return ok(row);
      }
      if (method === 'PUT') { testResults = testResults.map((r) => (r.id === body?.id ? { ...r, ...body } : r)); return ok(); }
      if (method === 'DELETE') { testResults = testResults.filter((r) => r.id !== body?.id); return ok(); }
      return ok(testResults);
    }

    default:
      // Loud rather than silent: an unmocked route should be obvious in the
      // console, not look like an empty screen.
      console.warn('[mock] no fixture for ' + method + ' ' + route + ' — returning []');
      return { status: 200, payload: [] };
  }
}

/** Stands in for `fetch` in `apiRequest`, returning a real Response. */
export async function mockApiRequest(endpoint: string, method: string, body: unknown): Promise<Response> {
  const { status, payload } = resolve(routeOf(endpoint), method.toUpperCase(), body);
  // A small delay keeps loading states reachable — several screens only render
  // their spinner branch on a request that does not resolve synchronously.
  await new Promise((r) => setTimeout(r, 60));
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
