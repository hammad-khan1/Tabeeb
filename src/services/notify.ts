/**
 * Where alerts and reminders go besides the screen.
 *
 * Today that is nowhere: reminders are in-app and the default notifier does nothing.
 * WhatsApp, SMS or web push plug in through `setNotifier` without changing a caller.
 * A failed send is logged and reported as false, never thrown: a gateway being down
 * must not stop a low reading from being recorded and shown.
 */

/** Every message goes out in Urdu script, Roman Urdu and English. */
export interface AlertText {
  ur: string;
  roman: string;
  en: string;
}

export interface NotifyMessage {
  kind: 'glucose_alert' | 'reminder' | 'pregnancy_danger' | 'visit_reminder';
  recipient: 'patient' | 'caregiver';
  /** Required for a caregiver; the patient is reached through their account. */
  contact?: { name: string | null; phone: string };
  text: AlertText;
}

export interface Notifier {
  send(userId: string, message: NotifyMessage): Promise<void>;
}

const noopNotifier: Notifier = {
  async send() {},
};

let current: Notifier = noopNotifier;

/** Pass null to go back to the no-op default. */
export function setNotifier(notifier: Notifier | null): void {
  current = notifier ?? noopNotifier;
}

export async function notify(userId: string, message: NotifyMessage): Promise<boolean> {
  try {
    await current.send(userId, message);
    return true;
  } catch (error) {
    console.warn(
      `[notify] ${message.kind} to ${message.recipient} failed:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}
