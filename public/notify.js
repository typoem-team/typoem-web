// public/notify.js
// 아침 알림 — "오늘의 시가 도착했어요" every morning at the time picked in 설정.
// Scheduled on the phone itself (Capacitor LocalNotifications), no server: so the text is fixed
// (today's poem isn't picked yet when the alarm is set). Only shown inside the app.
//
//   localStorage['typoem:morning'] = 'HH:MM' (on) | missing (off)
// The app repo (typoem-app) installs @capacitor/local-notifications; without it this section stays hidden.
// Depends on ui.js (TypoemUI.toast).

(function () {
  'use strict';

  var UI = window.TypoemUI;
  var KEY = 'typoem:morning';
  var ID = 1;                     // one repeating notification, replaced when the time changes
  var CHANNEL = 'morning';
  var C = window.Capacitor;
  var LN = C && C.isPluginAvailable && C.isPluginAvailable('LocalNotifications') && C.Plugins.LocalNotifications;
  var section = document.getElementById('notify-section');
  if (!LN || !section) return;     // a browser, or an app build without the plugin

  var on = document.getElementById('notify-on');
  var time = document.getElementById('notify-time');
  var timeRow = document.getElementById('notify-time-row');

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function save(v) {
    try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* this visit only */ }
  }

  async function cancel() {
    try { await LN.cancel({ notifications: [{ id: ID }] }); } catch (e) { /* nothing scheduled */ }
  }

  // 'HH:MM' -> a daily notification at that time. Returns false if the user said no.
  async function schedule(hhmm) {
    var perm = await LN.checkPermissions();
    if (perm.display !== 'granted') perm = await LN.requestPermissions();
    if (perm.display !== 'granted') return false;
    try {   // Android 8+: the channel name is what people see in the phone's notification settings
      await LN.createChannel({ id: CHANNEL, name: '오늘의 시 아침 알림', importance: 3 });
    } catch (e) { /* iOS / older Android: no channels */ }
    var p = hhmm.split(':').map(Number);
    await cancel();
    await LN.schedule({
      notifications: [{
        id: ID,
        channelId: CHANNEL,
        title: '오늘의 시가 도착했어요',
        body: '영시 한 편과 함께 차분한 하루를 시작해 보세요.',
        smallIcon: 'ic_stat_typoem',
        // inexact on purpose: no exact-alarm permission in the app, and a few minutes late is fine.
        // (plugin 8.3+ defaults to true and would open the system '알람 및 리마인더' screen on every schedule)
        isExactNotification: false,
        schedule: { on: { hour: p[0], minute: p[1] }, allowWhileIdle: true },
      }],
    });
    return true;
  }

  function draw() {
    var v = saved();
    on.checked = !!v;
    timeRow.hidden = !v;
    if (v) time.value = v;
  }

  async function apply() {
    var hhmm = time.value || '08:00';
    on.disabled = true;
    try {
      if (!on.checked) {
        await cancel();
        save(null);
        UI.toast('아침 알림을 껐어요');
      } else if (await schedule(hhmm)) {
        save(hhmm);
        UI.toast('매일 ' + hhmm + '경 오늘의 시를 알려 드릴게요');   // inexact alarm: Android may deliver it up to an hour late
      } else {
        save(null);
        UI.toast('기기 설정에서 Typoem의 알림 권한을 허용해 주세요');
      }
    } catch (e) {
      UI.toast('알림을 설정하지 못했어요');
    } finally {
      on.disabled = false;
      draw();
    }
  }

  section.hidden = false;
  draw();
  on.addEventListener('change', apply);
  time.addEventListener('change', function () { if (on.checked) apply(); });
})();
