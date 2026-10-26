/*
 * The ONLY file you edit to point the site at the game. Plain JavaScript, no build step.
 * Tek düzenlenecek ayar dosyası: oyunun adresi ve iletişim e-postası.
 *
 * Why a script file and not JSON: it loads before the page paints, so every "Play" button already has the
 * right address, and it works on any static host without a server.
 */
window.ARCHONBITE_CONFIG = {
  /* Where the QuizNight game runs (the game server, NOT this website). No trailing slash.
     Oyunun çalıştığı adres (bu site değil, oyun sunucusu). Sonunda "/" olmasın. */
  PLAY_URL: 'https://quiz.archonbite.com',

  /* Paths on the game server. The TV opens TV_PATH; phones open JOIN_PATH (+ "/ROOMCODE").
     They match the game itself (apps/web routes /tv and /join/CODE). */
  TV_PATH: '/tv',
  JOIN_PATH: '/join',

  /* TODO-OWNER: set to false until quiz.archonbite.com is really online. The Play page then shows
     "coming soon" instead of a button that leads nowhere.
     TODO-OWNER: oyun sunucusu gerçekten yayına girene kadar false yapın. */
  PLAY_LIVE: true,

  /* TODO-OWNER: a real mailbox you read. This is a PLACEHOLDER address; it feeds the venue block,
     the footer and the legal page. / Gerçek bir e-posta adresi yazın; şu an yer tutucu. */
  CONTACT_EMAIL: 'hello@archonbite.com',

  /* The public address of THIS website (share links only). */
  SITE_URL: 'https://archonbite.com'
};
