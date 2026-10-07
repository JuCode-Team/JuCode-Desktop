import { describe, it, expect, beforeEach } from 'vitest';
import { setLocale } from './i18n';
import { summary, toWire, upsert, validate, usageCost, type Schedule, type ScheduleDraft, type ScheduleUsageTotals } from './schedules';

const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
	agent: 'ops',
	name: 'Check',
	prompt: 'Look at the logs',
	enabled: true,
	repeat: 'daily',
	time: '11:00',
	days: [],
	date: '',
	new_session: true,
	...over
});

describe('schedule summary', () => {
	beforeEach(() => setLocale('zh'));

	it('says when each kind repeats', () => {
		expect(summary({ repeat: 'daily', time: '11:00' })).toBe('每天 11:00');
		expect(summary({ repeat: 'weekdays', time: '09:30' })).toBe('工作日 09:30');
		expect(summary({ repeat: 'hourly', time: '00:15' })).toBe('每小时第 15 分');
		expect(summary({ repeat: 'once', time: '11:00', date: '2026-10-02' })).toBe('10月2日 11:00 一次');
	});

	it('lists weekly days Monday first, Sunday last', () => {
		expect(summary({ repeat: 'weekly', time: '18:00', days: [3, 1] })).toBe('每周一、三 18:00');
		expect(summary({ repeat: 'weekly', time: '08:00', days: [0, 6] })).toBe('每周六、日 08:00');
	});

	it('speaks English too', () => {
		setLocale('en');
		expect(summary({ repeat: 'weekly', time: '18:00', days: [1, 3] })).toBe('Every Mon, Wed at 18:00');
		expect(summary({ repeat: 'hourly', time: '00:05' })).toBe('Every hour, 5 min past');
		expect(summary({ repeat: 'once', time: '11:00', date: '2026-10-02' })).toBe('Once, Oct 2 at 11:00');
	});
});

describe('schedule validation', () => {
	beforeEach(() => setLocale('zh'));
	const now = new Date(2026, 9, 1, 12, 0);

	it('accepts a complete draft', () => {
		expect(validate(draft(), now)).toBeNull();
		expect(validate(draft({ repeat: 'weekly', days: [1] }), now)).toBeNull();
		expect(validate(draft({ repeat: 'once', date: '2026-10-02' }), now)).toBeNull();
	});

	it('refuses what the daemon would', () => {
		expect(validate(draft({ name: ' ' }), now)).toBe('请填写名称');
		expect(validate(draft({ prompt: '' }), now)).toBe('请填写任务内容');
		expect(validate(draft({ time: '24:00' }), now)).toBe('时间格式不对');
		expect(validate(draft({ time: '9:00' }), now)).toBe('时间格式不对');
		expect(validate(draft({ repeat: 'weekly', days: [] }), now)).toBe('至少选一天');
		expect(validate(draft({ repeat: 'weekly', days: [7] }), now)).toBe('至少选一天');
		expect(validate(draft({ repeat: 'once', date: '2026-02-30' }), now)).toBe('日期不对');
		expect(validate(draft({ repeat: 'once', date: '2026-10-01', time: '11:00' }), now)).toBe('这个时间已经过了');
	});
});

describe('schedule wire shape', () => {
	it('sends days and date only where they apply', () => {
		expect(toWire(draft({ days: [3, 1], date: '2026-10-02' }))).toEqual({
			agent: 'ops',
			name: 'Check',
			prompt: 'Look at the logs',
			enabled: true,
			repeat: 'daily',
			time: '11:00',
			new_session: true
		});
		expect(toWire(draft({ id: 'sch-1', repeat: 'weekly', days: [5, 1] }))).toMatchObject({ id: 'sch-1', days: [1, 5] });
		expect(toWire(draft({ repeat: 'once', date: '2026-10-02' })).date).toBe('2026-10-02');
	});

	it('replaces a saved schedule by id or appends a new one', () => {
		const a = { id: 'a', name: 'A' } as Schedule;
		const b = { id: 'b', name: 'B' } as Schedule;
		expect(upsert([a], b).map((s) => s.id)).toEqual(['a', 'b']);
		expect(upsert([a, b], { ...a, name: 'A2' }).map((s) => s.name)).toEqual(['A2', 'B']);
	});
});


describe('schedule usage amounts', () => {
	it('keeps settled points and estimated USD distinct, including zero and unknown', () => {
		const usage = { gateway_cost: 0.05, estimated_cost_usd: 0.12 } as ScheduleUsageTotals;
		expect(usageCost(usage)).toBe('实际 0.0500 积分 · 估算 $0.1200');
		expect(usageCost({ ...usage, gateway_cost: 0, estimated_cost_usd: null })).toBe('实际 0.0000 积分');
		expect(usageCost({ ...usage, gateway_cost: null, estimated_cost_usd: null })).toBe('—');
	});
});
