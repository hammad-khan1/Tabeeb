/**
 * Interface language.
 *
 * `users.preferredLanguage` was a dead setting: the Settings page saved it, the API
 * returned it, and nothing ever read it. The Urdu font was loaded and a `.font-urdu`
 * utility with `direction: rtl` sat in globals.css unused, while `<html lang="en">`
 * was hardcoded — so an Urdu-speaking patient got an English interface no matter what
 * they chose.
 *
 * `mixed` is a valid value for a *document* but not for the interface, so it maps to
 * English chrome here; a mixed-language document still gets its own treatment in the
 * summarizer.
 */

export const UI_LOCALES = ['en', 'ur'] as const;
export type Locale = (typeof UI_LOCALES)[number];

export type PreferredLanguage = 'en' | 'ur' | 'mixed';

export function toLocale(preference: PreferredLanguage | null | undefined): Locale {
  return preference === 'ur' ? 'ur' : 'en';
}

export function directionFor(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ur' ? 'rtl' : 'ltr';
}

/**
 * Translations. Medical terms and medicine names deliberately stay in Latin script
 * even in the Urdu interface — that is how they are printed on the box and on the
 * prescription, so translating them would make them harder to match, not easier.
 */
const STRINGS = {
  // ── Navigation ───────────────────────────────────────────────────────────
  'nav.dashboard': { en: 'Dashboard', ur: 'ڈیش بورڈ' },
  'nav.documents': { en: 'Documents', ur: 'دستاویزات' },
  'nav.chat': { en: 'Ask Tabeeb', ur: 'طبیب سے پوچھیں' },
  'nav.history': { en: 'History', ur: 'تاریخ' },
  'nav.interactions': { en: 'Interactions', ur: 'دواؤں کا تعامل' },
  'nav.trends': { en: 'Trends', ur: 'رجحانات' },
  'nav.insights': { en: 'Insights', ur: 'بصیرت' },
  'nav.settings': { en: 'Settings', ur: 'ترتیبات' },
  'nav.options': { en: 'Options', ur: 'اختیارات' },
  'nav.ramadan': { en: 'Ramzan Mode', ur: 'رمضان موڈ' },

  // ── Common actions ───────────────────────────────────────────────────────
  'action.upload': { en: 'Upload Document', ur: 'دستاویز اپ لوڈ کریں' },
  'action.save': { en: 'Save', ur: 'محفوظ کریں' },
  'action.saving': { en: 'Saving…', ur: 'محفوظ ہو رہا ہے…' },
  'action.cancel': { en: 'Cancel', ur: 'منسوخ کریں' },
  'action.delete': { en: 'Delete', ur: 'حذف کریں' },
  'action.reprocess': { en: 'Reprocess', ur: 'دوبارہ پروسیس کریں' },
  'action.retry': { en: 'Try again', ur: 'دوبارہ کوشش کریں' },
  'action.download': { en: 'Download', ur: 'ڈاؤن لوڈ کریں' },

  // ── Status ───────────────────────────────────────────────────────────────
  'status.loading': { en: 'Loading…', ur: 'لوڈ ہو رہا ہے…' },
  'status.processing': { en: 'Processing', ur: 'پروسیس ہو رہا ہے' },
  'status.pending': { en: 'Pending', ur: 'زیرِ التوا' },
  'status.needsReview': { en: 'Needs review', ur: 'جانچ درکار ہے' },
  'status.confirmed': { en: 'Confirmed', ur: 'تصدیق شدہ' },
  'status.failed': { en: 'Failed', ur: 'ناکام' },

  // ── Settings ─────────────────────────────────────────────────────────────
  'settings.title': { en: 'Settings', ur: 'ترتیبات' },
  'settings.language': { en: 'Language', ur: 'زبان' },
  'settings.languageHelp': {
    en: 'Changes the app interface and the language your document summaries are written in.',
    ur: 'اس سے ایپ کا انٹرفیس اور آپ کی دستاویزات کے خلاصے کی زبان بدل جاتی ہے۔',
  },
  'settings.email': { en: 'Email', ur: 'ای میل' },
  'settings.allergies': { en: 'Known allergies', ur: 'معلوم الرجی' },
  'settings.conditions': { en: 'Known conditions', ur: 'معلوم بیماریاں' },
  'settings.deleteAll': { en: 'Delete all data', ur: 'تمام ڈیٹا حذف کریں' },

  // ── Errors ───────────────────────────────────────────────────────────────
  'error.title': { en: 'Something went wrong', ur: 'کچھ غلط ہو گیا' },
  'error.body': {
    en: 'This page could not be displayed. Your medical records are safe — nothing was changed.',
    ur: 'یہ صفحہ نہیں دکھایا جا سکا۔ آپ کا طبی ریکارڈ محفوظ ہے — کچھ تبدیل نہیں ہوا۔',
  },
  'error.notFound': { en: 'Page not found', ur: 'صفحہ نہیں ملا' },
  'error.notFoundBody': {
    en: 'The page you are looking for does not exist or has been moved.',
    ur: 'آپ جو صفحہ تلاش کر رہے ہیں وہ موجود نہیں یا منتقل ہو چکا ہے۔',
  },
  'error.backToDashboard': { en: 'Back to dashboard', ur: 'ڈیش بورڈ پر واپس' },

  // ── Ramzan Mode ──────────────────────────────────────────────────────────
  // The alert wording itself lives in services/ramadan/glucose-rules, next to the
  // rule that raises it. A doctor should review the Urdu before release.
  'ramadan.title': { en: 'Ramzan Mode', ur: 'رمضان موڈ' },
  'ramadan.subtitle': { en: 'Fast more safely with diabetes', ur: 'ذیابیطس کے ساتھ محفوظ روزہ' },
  'ramadan.guidance': {
    en: 'This is medical guidance, not a religious ruling. The decision to fast is yours, with your doctor and your scholar.',
    ur: 'یہ طبی رہنمائی ہے، دینی فتویٰ نہیں۔ روزہ رکھنے کا فیصلہ آپ کا ہے، اپنے ڈاکٹر اور عالم کے مشورے سے۔',
  },

  'ramadan.optIn.question': {
    en: 'Ramzan is coming. Do you plan to fast?',
    ur: 'رمضان آ رہا ہے۔ کیا آپ روزہ رکھنے کا ارادہ رکھتے ہیں؟',
  },
  'ramadan.optIn.yes': { en: 'Yes, I plan to fast', ur: 'جی ہاں، روزہ رکھنے کا ارادہ ہے' },
  'ramadan.optIn.no': { en: 'No, not this year', ur: 'نہیں، اس سال نہیں' },
  'ramadan.optIn.city': { en: 'Your city', ur: 'آپ کا شہر' },
  'ramadan.optIn.useLocation': { en: 'Use my location instead', ur: 'اس کے بجائے میرا مقام استعمال کریں' },
  'ramadan.optIn.locationError': {
    en: 'Could not read your location. Please choose a city.',
    ur: 'آپ کا مقام معلوم نہیں ہو سکا۔ براہ کرم شہر منتخب کریں۔',
  },
  'ramadan.optIn.locationSet': { en: 'Using your location', ur: 'آپ کا مقام استعمال ہو رہا ہے' },
  'ramadan.optIn.start': { en: 'First fast', ur: 'پہلا روزہ' },
  'ramadan.optIn.end': { en: 'Last fast', ur: 'آخری روزہ' },
  'ramadan.optIn.datesNote': {
    en: 'These dates are an estimate. Change them when the moon is sighted.',
    ur: 'یہ تاریخیں اندازاً ہیں۔ چاند نظر آنے پر انہیں بدل لیں۔',
  },
  'ramadan.optIn.caregiver': { en: 'Family member to alert (optional)', ur: 'خاندان کا فرد جسے اطلاع دی جائے (اختیاری)' },
  'ramadan.optIn.caregiverName': { en: 'Name', ur: 'نام' },
  'ramadan.optIn.caregiverPhone': { en: 'Phone number', ur: 'فون نمبر' },
  'ramadan.optIn.noDiabetes': {
    en: 'Ramzan Mode is for people with diabetes. Your record has no diabetes diagnosis, but you can still use it.',
    ur: 'رمضان موڈ ذیابیطس کے مریضوں کے لیے ہے۔ آپ کے ریکارڈ میں ذیابیطس کی تشخیص نہیں، لیکن آپ پھر بھی اسے استعمال کر سکتے ہیں۔',
  },
  'ramadan.optIn.notFasting': {
    en: 'You told us you are not fasting this year. You can change this at any time.',
    ur: 'آپ نے بتایا کہ اس سال روزہ نہیں رکھ رہے۔ آپ کسی بھی وقت اسے بدل سکتے ہیں۔',
  },
  'ramadan.optIn.change': { en: 'Change my plan', ur: 'اپنا پلان بدلیں' },

  'ramadan.risk.title': { en: 'Fasting risk check', ur: 'روزے کے خطرے کی جانچ' },
  'ramadan.risk.question': { en: 'Question', ur: 'سوال' },
  'ramadan.risk.of': { en: 'of', ur: 'میں سے' },
  'ramadan.risk.fromRecord': { en: 'From your record', ur: 'آپ کے ریکارڈ سے' },
  'ramadan.risk.suggested': {
    en: 'Your record suggests this answer. Please check it.',
    ur: 'آپ کا ریکارڈ یہ جواب بتاتا ہے۔ براہ کرم اسے دیکھ لیں۔',
  },
  'ramadan.risk.voice': { en: 'Answer by voice', ur: 'آواز سے جواب دیں' },
  'ramadan.risk.stop': { en: 'Stop recording', ur: 'ریکارڈنگ روکیں' },
  'ramadan.risk.heard': { en: 'We heard', ur: 'ہم نے سنا' },
  'ramadan.risk.voiceNoMatch': {
    en: 'We could not match that to an answer. Please tap one.',
    ur: 'یہ کسی جواب سے نہیں ملا۔ براہ کرم ایک جواب چنیں۔',
  },
  'ramadan.risk.back': { en: 'Back', ur: 'پیچھے' },
  'ramadan.risk.reason.always_asked': { en: 'Only you can answer this.', ur: 'اس کا جواب صرف آپ دے سکتے ہیں۔' },
  'ramadan.risk.reason.not_in_record': { en: 'This is not in your record.', ur: 'یہ آپ کے ریکارڈ میں نہیں۔' },
  'ramadan.risk.reason.record_too_old': {
    en: 'Your last result is too old to use.',
    ur: 'آپ کا آخری نتیجہ استعمال کے لیے بہت پرانا ہے۔',
  },
  'ramadan.risk.reason.needs_detail': {
    en: 'Your record does not say enough to answer this.',
    ur: 'آپ کے ریکارڈ میں اس کے جواب کے لیے پوری تفصیل نہیں۔',
  },
  'ramadan.risk.reason.conflicting': { en: 'Your records disagree.', ur: 'آپ کے ریکارڈ میں تضاد ہے۔' },
  'ramadan.risk.reason.unrecognised_medicines': {
    en: 'We could not identify all of your medicines.',
    ur: 'ہم آپ کی تمام دوائیں نہیں پہچان سکے۔',
  },
  'ramadan.risk.reason.combination_unverified': {
    en: 'You take more than one diabetes medicine that changes the score.',
    ur: 'آپ ایک سے زیادہ ایسی دوائیں لیتے ہیں جو اسکور بدلتی ہیں۔',
  },

  'ramadan.result.title': { en: 'Your result', ur: 'آپ کا نتیجہ' },
  'ramadan.result.low': { en: 'Low risk', ur: 'کم خطرہ' },
  'ramadan.result.lowAdvice': {
    en: 'Fasting is probably safe. Keep logging your sugar.',
    ur: 'روزہ غالباً محفوظ ہے۔ اپنی شوگر درج کرتے رہیں۔',
  },
  'ramadan.result.moderate': { en: 'Moderate risk', ur: 'درمیانہ خطرہ' },
  'ramadan.result.moderateAdvice': {
    en: 'Probably safe if your doctor adjusts your medicines and you check your sugar closely. Share your plan with your doctor.',
    ur: 'اگر ڈاکٹر آپ کی دوائیں ایڈجسٹ کریں اور آپ شوگر باقاعدگی سے چیک کریں تو غالباً محفوظ ہے۔ اپنا پلان ڈاکٹر کو دکھائیں۔',
  },
  'ramadan.result.high': { en: 'High risk', ur: 'زیادہ خطرہ' },
  'ramadan.result.highAdvice': {
    en: 'Fasting is probably unsafe. Talk to your doctor before you fast.',
    ur: 'روزہ غالباً محفوظ نہیں۔ روزہ رکھنے سے پہلے اپنے ڈاکٹر سے بات کریں۔',
  },
  'ramadan.result.incomplete': { en: 'Score not ready yet', ur: 'اسکور ابھی تیار نہیں' },
  'ramadan.result.missing': { en: 'Some questions are still unanswered.', ur: 'کچھ سوالوں کے جواب ابھی باقی ہیں۔' },
  'ramadan.result.unverified': {
    en: 'A doctor is still checking some of the guideline values, so no score is shown yet. Your answers are saved.',
    ur: 'رہنما اصولوں کی کچھ اقدار ابھی ڈاکٹر جانچ رہے ہیں، اس لیے ابھی اسکور نہیں دکھایا جا رہا۔ آپ کے جوابات محفوظ ہیں۔',
  },
  'ramadan.result.score': { en: 'Score', ur: 'اسکور' },
  'ramadan.result.points': { en: 'points', ur: 'پوائنٹس' },
  'ramadan.result.pointsPending': { en: 'points being checked', ur: 'پوائنٹس کی جانچ جاری ہے' },
  'ramadan.result.source.record': { en: 'From your record', ur: 'آپ کے ریکارڈ سے' },
  'ramadan.result.source.answer': { en: 'Your answer', ur: 'آپ کا جواب' },
  'ramadan.result.source.override': { en: 'You changed the record value', ur: 'آپ نے ریکارڈ کی قدر بدلی' },
  'ramadan.result.edit': { en: 'Change answers', ur: 'جوابات بدلیں' },
  'ramadan.result.continue': { en: 'Answer the remaining questions', ur: 'باقی سوالوں کے جواب دیں' },

  'ramadan.share.button': { en: 'Share plan with doctor', ur: 'پلان ڈاکٹر کو بھیجیں' },
  'ramadan.share.ready': { en: 'Link ready. It works for 30 days.', ur: 'لنک تیار ہے۔ یہ 30 دن کام کرے گا۔' },
  'ramadan.share.copy': { en: 'Copy link', ur: 'لنک کاپی کریں' },
  'ramadan.share.copied': { en: 'Copied', ur: 'کاپی ہو گیا' },

  'ramadan.today.title': { en: 'Today', ur: 'آج' },
  'ramadan.today.sehriEnds': { en: 'Sehri ends', ur: 'سحری کا اختتام' },
  'ramadan.today.iftar': { en: 'Iftar', ur: 'افطار' },
  'ramadan.today.untilIftar': { en: 'until Iftar', ur: 'افطار میں باقی' },
  'ramadan.today.untilSehri': { en: 'until Sehri ends', ur: 'سحری ختم ہونے میں باقی' },
  'ramadan.today.preview': {
    en: 'Ramzan has not started yet. This shows what a fasting day will look like.',
    ur: 'رمضان ابھی شروع نہیں ہوا۔ یہ دکھاتا ہے کہ روزے کا دن کیسا ہوگا۔',
  },
  'ramadan.today.timetableNote': {
    en: 'Times are calculated for your city. For Sehri, follow your local mosque timetable.',
    ur: 'اوقات آپ کے شہر کے لیے حساب کیے گئے ہیں۔ سحری کے لیے اپنی مقامی مسجد کے نظام الاوقات پر عمل کریں۔',
  },
  'ramadan.today.reminders': { en: 'Reminders', ur: 'یاد دہانیاں' },
  'ramadan.today.nextMedicine': { en: 'Next medicine', ur: 'اگلی دوا' },
  'ramadan.today.askDoctor': {
    en: 'Ask your doctor to adjust these for Ramzan',
    ur: 'رمضان کے لیے یہ دوائیں اپنے ڈاکٹر سے ایڈجسٹ کروائیں',
  },
  'ramadan.today.askDoctorHelp': {
    en: 'Tabeeb does not move your medicines to Sehri or Iftar. Your doctor decides the Ramzan timing and dose.',
    ur: 'طبیب آپ کی دوائیں سحری یا افطار پر منتقل نہیں کرتا۔ رمضان میں وقت اور مقدار آپ کا ڈاکٹر طے کرے گا۔',
  },
  'ramadan.today.prescription': { en: "Doctor's Ramzan prescription", ur: 'ڈاکٹر کا رمضان کا نسخہ' },
  'ramadan.today.prescriptionHelp': {
    en: "After your doctor writes your Ramzan doses, upload the prescription and choose it here. Tabeeb will then remind you at Sehri and Iftar.",
    ur: 'ڈاکٹر کے رمضان کی خوراک لکھنے کے بعد نسخہ اپ لوڈ کریں اور یہاں منتخب کریں۔ پھر طبیب آپ کو سحری اور افطار پر یاد دلائے گا۔',
  },
  'ramadan.today.prescriptionNone': { en: 'None chosen', ur: 'کوئی منتخب نہیں' },
  'ramadan.today.unscheduled.awaiting_doctor_plan': {
    en: "Waiting for your doctor's Ramzan plan",
    ur: 'ڈاکٹر کے رمضان پلان کا انتظار ہے',
  },
  'ramadan.today.unscheduled.falls_in_fast': {
    en: 'This time falls during the fast. Check with your doctor.',
    ur: 'یہ وقت روزے کے دوران آتا ہے۔ ڈاکٹر سے پوچھیں۔',
  },
  'ramadan.today.unscheduled.timing_unclear': {
    en: 'The timing is unclear. Check with your doctor.',
    ur: 'وقت واضح نہیں۔ ڈاکٹر سے پوچھیں۔',
  },
  'ramadan.today.readings': { en: 'Recent readings', ur: 'حالیہ ریڈنگز' },
  'ramadan.today.noReadings': { en: 'No readings yet.', ur: 'ابھی کوئی ریڈنگ نہیں۔' },
  'ramadan.today.reminderOn': { en: 'Turn reminder off', ur: 'یاد دہانی بند کریں' },
  'ramadan.today.reminderOff': { en: 'Turn reminder on', ur: 'یاد دہانی آن کریں' },
  'ramadan.today.reminderIsOff': { en: 'off', ur: 'بند' },

  'ramadan.slot.sehri': { en: 'Sehri', ur: 'سحری' },
  'ramadan.slot.midday': { en: 'Midday', ur: 'دوپہر' },
  'ramadan.slot.pre_iftar': { en: 'Before Iftar', ur: 'افطار سے پہلے' },
  'ramadan.slot.iftar': { en: 'Iftar', ur: 'افطار' },
  'ramadan.slot.post_iftar': { en: 'After Iftar', ur: 'افطار کے بعد' },
  'ramadan.slot.bedtime': { en: 'Bedtime', ur: 'سونے کا وقت' },
  'ramadan.kind.sehri': { en: 'Eat Sehri', ur: 'سحری کھائیں' },
  'ramadan.kind.iftar': { en: 'Open your fast', ur: 'روزہ افطار کریں' },
  'ramadan.kind.glucose_check': { en: 'Check your sugar', ur: 'شوگر چیک کریں' },
  'ramadan.kind.medicine': { en: 'Medicine', ur: 'دوا' },

  'ramadan.log.button': { en: 'Log sugar', ur: 'شوگر درج کریں' },
  'ramadan.log.title': { en: 'Log your sugar', ur: 'اپنی شوگر درج کریں' },
  'ramadan.log.type': { en: 'Type', ur: 'لکھیں' },
  'ramadan.log.voice': { en: 'Speak', ur: 'بولیں' },
  'ramadan.log.photo': { en: 'Photo of meter', ur: 'میٹر کی تصویر' },
  'ramadan.log.placeholder': { en: 'e.g. 120 or "sugar 120"', ur: 'مثلاً ۱۲۰ یا "شوگر ۱۲۰"' },
  'ramadan.log.reading': { en: 'Reading', ur: 'ریڈنگ' },
  'ramadan.log.unit': { en: 'Unit', ur: 'اکائی' },
  'ramadan.log.symptoms': { en: 'Do you feel any of these?', ur: 'کیا آپ کو ان میں سے کچھ محسوس ہو رہا ہے؟' },
  'ramadan.log.submit': { en: 'Save reading', ur: 'ریڈنگ محفوظ کریں' },
  'ramadan.log.record': { en: 'Start speaking', ur: 'بولنا شروع کریں' },
  'ramadan.log.stopAndSave': { en: 'Stop and save', ur: 'روکیں اور محفوظ کریں' },
  'ramadan.log.choosePhoto': { en: 'Take or choose a photo', ur: 'تصویر لیں یا منتخب کریں' },
  'ramadan.log.working': { en: 'Working…', ur: 'کام جاری ہے…' },
  'ramadan.log.confirm': { en: 'Is this your reading?', ur: 'کیا یہ آپ کی ریڈنگ ہے؟' },
  'ramadan.log.confirmYes': { en: 'Yes, save it', ur: 'جی ہاں، محفوظ کریں' },
  'ramadan.log.confirmNo': { en: 'No, let me fix it', ur: 'نہیں، میں درست کرتا ہوں' },
  'ramadan.log.saved': { en: 'Reading saved', ur: 'ریڈنگ محفوظ ہو گئی' },

  'ramadan.symptom.shaking': { en: 'Shaking', ur: 'کپکپی' },
  'ramadan.symptom.sweating': { en: 'Sweating', ur: 'پسینہ' },
  'ramadan.symptom.confusion': { en: 'Confusion', ur: 'ذہنی الجھن' },
  'ramadan.symptom.fainting': { en: 'Fainting or dizziness', ur: 'بے ہوشی یا چکر' },
  'ramadan.symptom.acute_illness': { en: 'Feeling unwell (fever, vomiting)', ur: 'طبیعت خراب (بخار، الٹی)' },

  'ramadan.alertLevel.none': { en: 'No alert', ur: 'کوئی انتباہ نہیں' },
  'ramadan.alertLevel.low': { en: 'Low', ur: 'کم' },
  'ramadan.alertLevel.high': { en: 'High', ur: 'زیادہ' },
  'ramadan.alertLevel.symptom': { en: 'Symptoms', ur: 'علامات' },

  'ramadan.alert.title': { en: 'Break your fast now', ur: 'ابھی روزہ کھول دیں' },
  'ramadan.alert.done': { en: 'Done, I broke my fast', ur: 'ہو گیا، میں نے روزہ کھول دیا' },
  'ramadan.alert.recorded': { en: 'Recorded. Take care of yourself.', ur: 'درج ہو گیا۔ اپنا خیال رکھیں۔' },
  'ramadan.alert.caregiverNotified': { en: 'Your family member has been told.', ur: 'آپ کے گھر والوں کو اطلاع دے دی گئی ہے۔' },
  'ramadan.alert.close': { en: 'Close', ur: 'بند کریں' },
} as const;

export type TranslationKey = keyof typeof STRINGS;

export function translate(key: TranslationKey, locale: Locale): string {
  const entry = STRINGS[key];
  // Fall back to English rather than showing a raw key if a translation is missing.
  return entry[locale] ?? entry.en;
}

/** The `t` used across the app. */
export function createTranslator(locale: Locale) {
  return (key: TranslationKey): string => translate(key, locale);
}

/**
 * Urdu for the IDF-DAR risk items and options. The English is the label in
 * services/ramadan/constants, which stays the one source for it; keys are
 * `item` and `item.option`. Drug names stay in Latin script, as on the box.
 */
const RISK_LABELS_UR: Record<string, string> = {
  diabetes_type: 'ذیابیطس کی قسم',
  'diabetes_type.type1': 'ٹائپ 1 ذیابیطس',
  'diabetes_type.type2': 'ٹائپ 2 ذیابیطس',
  diabetes_duration: 'ذیابیطس کتنے عرصے سے ہے',
  'diabetes_duration.ten_or_more': '10 سال یا زیادہ',
  'diabetes_duration.under_ten': '10 سال سے کم',
  hypoglycaemia: 'شوگر کم ہونا (ہائپوگلیسیمیا)',
  'hypoglycaemia.unawareness': 'شوگر کم ہونے کا احساس نہیں ہوتا',
  'hypoglycaemia.recent_severe': 'حال ہی میں شوگر بہت زیادہ کم ہوئی',
  'hypoglycaemia.multiple_weekly': 'ہفتے میں کئی بار شوگر کم ہوتی ہے',
  'hypoglycaemia.under_once_weekly': 'ہفتے میں ایک بار سے کم',
  'hypoglycaemia.none': 'شوگر کم نہیں ہوتی',
  hba1c: 'شوگر کا کنٹرول (HbA1c)',
  'hba1c.over_9': 'HbA1c 9% سے زیادہ',
  'hba1c.7_5_to_9': 'HbA1c 7.5% سے 9%',
  'hba1c.under_7_5': 'HbA1c 7.5% سے کم',
  treatment: 'علاج کی قسم',
  'treatment.mixed_insulin_multiple': 'دن میں کئی بار مکسڈ انسولین',
  'treatment.basal_bolus_or_pump': 'بیسل بولس انسولین یا انسولین پمپ',
  'treatment.mixed_insulin_once': 'دن میں ایک بار مکسڈ انسولین',
  'treatment.basal_insulin': 'بیسل انسولین',
  'treatment.glibenclamide': 'Glibenclamide',
  'treatment.short_acting_su': 'Gliclazide / Gliclazide MR، Glimepiride یا Repaglinide',
  'treatment.other': 'دیگر علاج، نہ سلفونائل یوریا نہ انسولین',
  self_monitoring: 'گھر پر شوگر چیک کرنا',
  'self_monitoring.indicated_not_done': 'ضرورت ہے مگر چیک نہیں کرتے',
  'self_monitoring.indicated_suboptimal': 'ضرورت ہے مگر کم چیک کرتے ہیں',
  'self_monitoring.as_indicated': 'ہدایت کے مطابق چیک کرتے ہیں',
  acute_complications: 'شدید پیچیدگی (DKA یا HHS)',
  'acute_complications.last_3_months': 'پچھلے 3 مہینوں میں DKA یا HHS',
  'acute_complications.last_6_months': 'پچھلے 6 مہینوں میں DKA یا HHS',
  'acute_complications.last_12_months': 'پچھلے 12 مہینوں میں DKA یا HHS',
  'acute_complications.none': 'DKA یا HHS نہیں ہوا',
  macrovascular: 'دل یا دماغ کی شریانوں کی بیماری',
  'macrovascular.unstable': 'غیر مستحکم بیماری',
  'macrovascular.stable': 'مستحکم بیماری',
  'macrovascular.none': 'ایسی کوئی بیماری نہیں',
  renal: 'گردوں کی کارکردگی (eGFR)',
  'renal.egfr_under_30': 'eGFR 30 سے کم',
  'renal.egfr_30_45': 'eGFR 30 سے 45',
  'renal.egfr_45_60': 'eGFR 45 سے 60',
  'renal.egfr_over_60': 'eGFR 60 سے زیادہ',
  pregnancy: 'حمل',
  'pregnancy.not_within_targets': 'حاملہ، شوگر ہدف سے باہر',
  'pregnancy.within_targets': 'حاملہ، شوگر ہدف کے اندر',
  'pregnancy.not_pregnant': 'حاملہ نہیں',
  frailty_cognition: 'کمزوری اور یادداشت',
  'frailty_cognition.impaired_or_frail': 'یادداشت کمزور، یا جسمانی طور پر بہت کمزور',
  'frailty_cognition.over_70_no_support': '70 سال سے زیادہ عمر اور گھر میں مدد نہیں',
  'frailty_cognition.none': 'کمزوری یا یادداشت کا کوئی مسئلہ نہیں',
  physical_labour: 'جسمانی مشقت',
  'physical_labour.high': 'بہت سخت جسمانی کام',
  'physical_labour.moderate': 'درمیانہ جسمانی کام',
  'physical_labour.none': 'جسمانی مشقت نہیں',
  previous_ramadan: 'پچھلے رمضان کا تجربہ',
  'previous_ramadan.negative': 'مجموعی طور پر برا تجربہ',
  'previous_ramadan.not_negative': 'کوئی برا تجربہ نہیں',
  fasting_hours: 'روزے کے گھنٹے',
  'fasting_hours.sixteen_or_more': '16 گھنٹے یا زیادہ',
  'fasting_hours.under_sixteen': '16 گھنٹے سے کم',
};

/** The label for a risk item (`option` omitted) or one of its options. */
export function riskLabel(locale: Locale, english: string, item: string, option?: string): string {
  if (locale !== 'ur') return english;
  return RISK_LABELS_UR[option ? `${item}.${option}` : item] ?? english;
}

export function hasUrduRiskLabel(item: string, option?: string): boolean {
  return (option ? `${item}.${option}` : item) in RISK_LABELS_UR;
}
