// public/index.js
// Home — this week's streak on top, every room below as a card.
// The cards come from rooms.js (the same list as the 방 tab); the streak from streak.js
// (its look is step 8: keep [data-streak], #streak-week and the ids it fills).
//
// Depends on auth.js, ui.js, streak.js (TypoemStreak), rooms.js (loadRooms).

window.TypoemNative.setStatusBar('dark');   // dark status bar text on the paper background (the app uses this)
TypoemStreak.load();                        // hides itself on 404

// Back from a room via the back/forward cache: the room set a light status bar,
// and the order (last opened first) and today's titles may have changed.
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  window.TypoemNative.setStatusBar('dark');
  loadRooms();
});
