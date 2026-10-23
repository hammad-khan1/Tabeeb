import { describe, it, expect, vi, afterEach } from 'vitest';
import { notify, setNotifier, type NotifyMessage } from './notify';

const MESSAGE: NotifyMessage = {
  kind: 'glucose_alert',
  recipient: 'caregiver',
  contact: { name: 'Ayesha', phone: '+923001234567' },
  text: { ur: 'روزہ فوراً کھول دیں', roman: 'Roza foran khol dein', en: 'Break your fast now' },
};

afterEach(() => setNotifier(null));

describe('notify', () => {
  it('does nothing by default, successfully', async () => {
    expect(await notify('user-1', MESSAGE)).toBe(true);
  });

  it('hands the message to the configured notifier', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    setNotifier({ send });

    await notify('user-1', MESSAGE);
    expect(send).toHaveBeenCalledWith('user-1', MESSAGE);
  });

  it('reports a failed send instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setNotifier({ send: vi.fn().mockRejectedValue(new Error('gateway down')) });

    expect(await notify('user-1', MESSAGE)).toBe(false);
    warn.mockRestore();
  });
});
