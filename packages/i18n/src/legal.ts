import type { Locale } from './index';
import { legalLinks } from './legal-links';

/**
 * The texts of /privacy, /terms and /support (Turkish first, English second). They are drafts built
 * from the engineering inventory in docs/PRIVACY.md, NOT legal advice: the owner fills every
 * `OWNER-TO-FILL` value and has the texts reviewed by counsel before launch (the release audit lists
 * them as an owner task while a marker is left). Retention numbers are the server's defaults
 * (`RETENTION_*`, docs/PRIVACY.md §3): change this text whenever the deployment overrides one.
 */
export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export interface LegalDoc {
  title: string;
  status: string;
  sections: LegalSection[];
}

export type LegalDocId = 'privacy' | 'terms' | 'support';

export interface LegalCatalog {
  docs: Record<LegalDocId, LegalDoc>;
  /** The banner on every legal page until the owner has the texts reviewed. */
  draftNotice: string;
  links: Record<LegalDocId, string>;
  /** Label of the jump link to the other language's copy on the same page. */
  jumpToOther: string;
  back: string;
}

const tr: LegalCatalog = {
  draftNotice:
    'TASLAK — Bu metin hukuki tavsiye değildir. Hizmetin sahibi, köşeli parantez içindeki OWNER-TO-FILL alanlarını doldurmalı ve metni yayına almadan önce bir hukukçuya inceletmelidir.',
  links: legalLinks.tr,
  jumpToOther: 'English version',
  back: 'Ana sayfa',
  docs: {
    privacy: {
      title: 'Gizlilik ve KVKK aydınlatma metni',
      status: 'Taslak · son güncelleme 19.10.2026',
      sections: [
        {
          heading: '1. Veri sorumlusu',
          paragraphs: [
            '6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında veri sorumlusu: [OWNER-TO-FILL: ad soyad / ticari unvan], [OWNER-TO-FILL: adres], [OWNER-TO-FILL: MERSİS veya vergi no]. İletişim: [OWNER-TO-FILL: e-posta adresi].',
          ],
        },
        {
          heading: '2. Hangi verileri işliyoruz',
          items: [
            'Oyun: oyunda kullandığın takma ad ve avatar, verdiğin cevaplar, kullandığın güçler ve puanlar. Oynamak için hesap gerekmez; oyuncular rastgele bir oturum kimliğiyle tanınır.',
            'Teknik kayıtlar: IP adresin ve cihaz kimliğin ham olarak saklanmaz, yalnızca geri çevrilemeyen anahtarlı özetleri (takma kimlik) kötüye kullanımı önlemek için tutulur.',
            'Hesap (isteğe bağlı): e-posta adresin, görünen adın, dil tercihin, giriş zamanların ve oturum kayıtların. Giriş kodları yalnızca özet olarak saklanır.',
            'Kişisel quizler (Blind Quiz, Özel Quiz): quizi hazırlayanın yazdığı başlık, sorular ve davet edilen kişilerin görünen adları; davet edilen kişinin cevapları şifreli saklanır ve quizi hazırlayana hiçbir zaman gösterilmez. "Kim Söyledi?" cümleleri yalnızca oda açıkken tutulur.',
            'Ürün istatistikleri: takma kimlikle, yalnızca izin verilen olay adları ve sayılar; takma ad, cevap veya serbest metin içermez.',
            'Bildirimler: bir soruyu bildirdiğinde bildirim nedeni ve sorunun kimliği; kim olduğun değil, oturumundan türetilen bir takma kimlik saklanır.',
            'Satın almalar: oyun şu an tamamen ücretsizdir ve tarayıcıda ödeme alınmaz. Kart bilgisi hiçbir zaman işlenmez.',
          ],
        },
        {
          heading: '3. Neden işliyoruz (amaç ve hukuki sebep)',
          items: [
            'Oyunu çalıştırmak, kopan bağlantıyı geri getirmek ve puanları hesaplamak (sözleşmenin ifası, KVKK md. 5/2-c).',
            'Hesabına giriş yapabilmen ve kişisel quizlerini saklamak (sözleşmenin ifası).',
            'Hileyi, spam ve kötüye kullanımı önlemek, güvenliği sağlamak (meşru menfaat, KVKK md. 5/2-f).',
            'Blind Quiz cevapları: cevap veren kişinin açık rızası (KVKK md. 5/1); rıza verilmeden hiçbir cevap kaydedilmez ve kişi dilediği an tüm cevaplarını silebilir.',
            'Hizmeti iyileştirmek için toplu istatistik (meşru menfaat).',
            '[OWNER-TO-FILL: hukukçunun onayladığı hukuki sebepler]',
          ],
        },
        {
          heading: '4. Ne kadar saklıyoruz',
          items: [
            'Kapanan odaların kayıtları (takma adlar, cevaplar, puanlar): oda kapandıktan 30 gün sonra otomatik silinir.',
            'Kişisel quiz içeren odaların oyun kayıtları ve "Kim Söyledi?" cümleleri: oda kapanırken silinir.',
            'Kişisel quizler: son kullanımdan 30 gün sonra, hesabın silinince ya da quizi silince hemen silinir.',
            'Giriş kodları: 24 saat sonra silinir (kod zaten 10 dakika geçerlidir).',
            'Oturumlar: süresi dolduktan veya kapatıldıktan 7 gün sonra silinir.',
            'Güvenlik kayıtları ve ürün istatistikleri: 180 gün sonra silinir.',
            'Hesap verileri: hesabını silene kadar.',
            'Yönetici işlem kayıtları ve (ileride olursa) satın alma kayıtları: yasal yükümlülükler nedeniyle daha uzun tutulur [OWNER-TO-FILL: süre].',
            'Yedekler: [OWNER-TO-FILL: yedek saklama süresi].',
          ],
        },
        {
          heading: '5. Kimlere aktarıyoruz',
          paragraphs: [
            'Verilerin satılmaz ve reklam için kullanılmaz. Hizmeti çalıştırmak için şu hizmet sağlayıcılarla paylaşılır: sunucu sağlayıcısı [OWNER-TO-FILL: firma ve ülke], e-posta gönderim hizmeti (yalnızca giriş kodu için e-posta adresin) [OWNER-TO-FILL: firma ve ülke]. Sağlayıcı yurt dışındaysa aktarım KVKK md. 9 kapsamında yapılır [OWNER-TO-FILL]. İsteğe bağlı yapay zekâ önerileri varsayılan olarak kapalıdır; açılırsa bu metin önceden güncellenir.',
          ],
        },
        {
          heading: '6. Çerezler ve tarayıcı depolaması',
          paragraphs: [
            'Reklam veya analiz çerezi ve üçüncü taraf betik kullanılmaz. Hesapla giriş yaptığında bir oturum çerezi, Blind Quiz cevaplarken o davete özel bir çerez kullanılır. Dil, tema, ses tercihleri ve odaya yeniden bağlanmak için gereken oturum anahtarı yalnızca kendi tarayıcında saklanır.',
          ],
        },
        {
          heading: '7. Hakların (KVKK md. 11)',
          items: [
            'Kişisel verinin işlenip işlenmediğini öğrenme ve işlenmişse bilgi talep etme,',
            'İşlenme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme,',
            'Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,',
            'Eksik veya yanlış işlenmişse düzeltilmesini, şartları oluşmuşsa silinmesini isteme ve bunun aktarılan kişilere bildirilmesini isteme,',
            'Yalnızca otomatik sistemlerle analiz sonucu aleyhine bir sonuca itiraz etme,',
            'Kanuna aykırı işleme nedeniyle zarara uğrarsan zararın giderilmesini talep etme.',
          ],
          paragraphs: [
            'Hesap verilerinin bir kopyasını (kişisel quizlerin dahil) ve hesabının silinmesini destek adresine yazarak isteyebilirsin; başvurun en geç 30 gün içinde ücretsiz yanıtlanır. Blind Quiz için cevap verdiysen, davet bağlantından cevaplarını görebilir ve tamamını kendin silebilirsin.',
          ],
        },
        {
          heading: '8. Çocuklar',
          paragraphs: [
            'Oyun takma adla oynanır ve kimlik istemez. Hesap açma için yaş sınırı: [OWNER-TO-FILL]. Küçüklerin ebeveyn gözetiminde oynaması önerilir.',
          ],
        },
        {
          heading: '9. İletişim',
          paragraphs: [
            'Gizlilikle ilgili her soru ve başvuru için: [OWNER-TO-FILL: e-posta adresi]. Kişisel Verileri Koruma Kurulu’na şikâyet hakkın saklıdır.',
          ],
        },
      ],
    },
    terms: {
      title: 'Kullanım koşulları',
      status: 'Taslak · son güncelleme 19.10.2026',
      sections: [
        {
          heading: '1. Hizmet',
          paragraphs: [
            'QuizNight, TV veya bilgisayar ekranında oynanan, telefonların kumanda olduğu bir parti quiz oyunudur. Hizmeti sunan: [OWNER-TO-FILL: ad soyad / ticari unvan, adres]. Oyunu kullanarak bu koşulları kabul etmiş olursun.',
          ],
        },
        {
          heading: '2. Ücretsiz oyun ve olası ücretli özellikler',
          paragraphs: [
            'Oyun şu an ücretsizdir. İleride isteğe bağlı ücretli özellikler sunulursa fiyat, içerik, cayma hakkı ve iade koşulları satın almadan önce açıkça gösterilir ve tüketici mevzuatına uygun ayrı koşullar uygulanır [OWNER-TO-FILL: satıcı bilgileri, mesafeli satış ve ön bilgilendirme metinleri].',
          ],
        },
        {
          heading: '3. Kurallar',
          items: [
            'Takma adlarda, "Kim Söyledi?" cümlelerinde ve kişisel quizlerde hakaret, nefret söylemi, taciz, başkasının kişisel bilgisi veya yasa dışı içerik kullanma.',
            'Bir Blind Quiz hazırlarken yalnızca rızası olan kişileri davet et; davet bağlantısını başkasıyla paylaşma.',
            'Oyunu bozmaya, hile yapmaya, sunucuya aşırı yük bindirmeye veya başkalarının hesabına erişmeye çalışma.',
            'Kurallara uymayan içerik kaldırılabilir; oyuncu odadan çıkarılabilir, hesap veya cihaz geçici ya da kalıcı olarak engellenebilir.',
          ],
        },
        {
          heading: '4. İçerik ve markalar',
          paragraphs: [
            'Sorular bilgi ve eğlence amaçlıdır; doğruluğu için özen gösterilir ama hatasız olduğu garanti edilmez. Hatalı bir soruyu oyun içinden bildirebilirsin.',
            'QuizNight; sorularında adı geçen filmlerin, dizilerin, kitapların veya markaların sahipleriyle bağlantılı değildir, onlar tarafından onaylanmamış veya desteklenmemiştir; adlar yalnızca soruların konusunu belirtmek için kullanılır. Tüm ticari markalar ilgili sahiplerine aittir.',
            'Kişisel quizlerdeki içeriğin sorumluluğu onu yazana aittir.',
          ],
        },
        {
          heading: '5. Sorumluluk',
          paragraphs: [
            'Hizmet "olduğu gibi" sunulur; kesintisiz veya hatasız çalışacağı garanti edilmez. Kanunun izin verdiği ölçüde dolaylı zararlardan sorumluluk kabul edilmez [OWNER-TO-FILL: hukukçunun onayladığı ifade].',
          ],
        },
        {
          heading: '6. Değişiklikler, uygulanacak hukuk',
          paragraphs: [
            'Koşullar değişirse güncel metin bu sayfada yayımlanır. Türkiye Cumhuriyeti hukuku uygulanır; uyuşmazlıklarda tüketici hakem heyetleri ve tüketici mahkemeleri yetkilidir [OWNER-TO-FILL].',
          ],
        },
      ],
    },
    support: {
      title: 'Destek',
      status: 'Taslak · son güncelleme 19.10.2026',
      sections: [
        {
          heading: 'Bize ulaş',
          paragraphs: [
            'E-posta: [OWNER-TO-FILL: destek e-posta adresi]. Genellikle [OWNER-TO-FILL: süre] içinde yanıt veririz.',
            'Yazarken şunları eklemen işimizi hızlandırır: oda kodu (varsa), kullandığın cihaz ve tarayıcı, sorunun yaşandığı yaklaşık saat. Şifre, giriş kodu veya davet bağlantısı gönderme.',
          ],
        },
        {
          heading: 'Sık sorulanlar',
          items: [
            'Telefon bağlanamıyor: TV ile aynı adresi açtığından ve oda kodunu doğru yazdığından emin ol; sayfayı yenilemek seni odaya geri getirir.',
            'Hatalı veya uygunsuz bir soru: cevap gösterilince telefondaki "Soruyu bildir" düğmesini kullan.',
            'Blind Quiz cevaplarımı silmek istiyorum: davet bağlantını aç ve "Tüm cevaplarımı sil" düğmesine bas.',
            'Hesap verilerimin kopyası veya hesabımın silinmesi: destek adresine hesabındaki e-posta adresinden yaz (Gizlilik sayfası, bölüm 7).',
          ],
        },
      ],
    },
  },
};

const en: LegalCatalog = {
  draftNotice:
    'DRAFT — This text is not legal advice. The owner of the service must fill every OWNER-TO-FILL field in square brackets and have the text reviewed by a lawyer before publishing it.',
  links: legalLinks.en,
  jumpToOther: 'Türkçe metin',
  back: 'Home',
  docs: {
    privacy: {
      title: 'Privacy notice',
      status: 'Draft · last updated 19 Oct 2026',
      sections: [
        {
          heading: '1. Data controller',
          paragraphs: [
            'Data controller under the Turkish Personal Data Protection Law No. 6698 (KVKK): [OWNER-TO-FILL: name / company name], [OWNER-TO-FILL: address], [OWNER-TO-FILL: registration or tax number]. Contact: [OWNER-TO-FILL: e-mail address].',
          ],
        },
        {
          heading: '2. What we process',
          items: [
            'Game: the nickname and avatar you use, your answers, the powers you use and your score. No account is needed to play; players are known by a random session id.',
            'Technical records: your IP address and device id are never stored as such, only keyed one-way digests (pseudonyms) used against abuse.',
            'Account (optional): your e-mail address, display name, language, sign-in times and session records. Sign-in codes are stored only as digests.',
            'Personal quizzes (Blind Quiz, Custom Quiz): the title, prompts and the display names of the invited people written by the quiz author; an invited person’s answers are stored encrypted and are never shown to the author. "Who Said It" statements exist only while the room is open.',
            'Product statistics: under a pseudonym, only allow-listed event names and numbers; never a nickname, an answer or free text.',
            'Reports: when you report a question, the reason and the question’s id; not who you are, only a pseudonym derived from your session.',
            'Purchases: the game is currently completely free and takes no payment in the browser. Card data is never processed.',
          ],
        },
        {
          heading: '3. Why (purpose and legal basis)',
          items: [
            'Running the game, restoring dropped connections and scoring (performance of a contract, KVKK art. 5/2-c).',
            'Letting you sign in and keeping your personal quizzes (performance of a contract).',
            'Preventing cheating, spam and abuse, and keeping the service secure (legitimate interest, KVKK art. 5/2-f).',
            'Blind Quiz answers: the explicit consent of the person answering (KVKK art. 5/1); nothing is stored before consent and the person can delete all their answers at any time.',
            'Aggregate statistics to improve the service (legitimate interest).',
            '[OWNER-TO-FILL: legal bases confirmed by counsel]',
          ],
        },
        {
          heading: '4. How long we keep it',
          items: [
            'Records of closed rooms (nicknames, answers, scores): deleted automatically 30 days after the room closes.',
            'Game records of rooms that used a personal quiz, and "Who Said It" statements: erased when the room closes.',
            'Personal quizzes: deleted 30 days after last use, or at once when you delete the quiz or your account.',
            'Sign-in codes: deleted after 24 hours (a code is valid for 10 minutes anyway).',
            'Sessions: deleted 7 days after they expire or are signed out.',
            'Security records and product statistics: deleted after 180 days.',
            'Account data: until you delete the account.',
            'Staff action logs and (should they ever exist) purchase records: kept longer for legal obligations [OWNER-TO-FILL: period].',
            'Backups: [OWNER-TO-FILL: backup retention period].',
          ],
        },
        {
          heading: '5. Who receives it',
          paragraphs: [
            'Your data is not sold and not used for advertising. To run the service it is shared with these providers: the server host [OWNER-TO-FILL: company and country] and the e-mail delivery service (only your address, for sign-in codes) [OWNER-TO-FILL: company and country]. Transfers abroad follow KVKK art. 9 [OWNER-TO-FILL]. Optional AI suggestions are off by default; this notice is updated before they are ever switched on.',
          ],
        },
        {
          heading: '6. Cookies and browser storage',
          paragraphs: [
            'No advertising or analytics cookies and no third-party scripts. A session cookie is used when you sign in, and a cookie specific to one invite when you answer a Blind Quiz. Your language, theme and sound settings and the key that lets you rejoin a room are kept in your own browser only.',
          ],
        },
        {
          heading: '7. Your rights (KVKK art. 11)',
          items: [
            'To learn whether your personal data is processed and to request information about it,',
            'To learn the purpose of processing and whether it is used accordingly,',
            'To know the third parties it is transferred to in Turkey or abroad,',
            'To ask for correction of incomplete or wrong data, for deletion where the conditions are met, and for these to be notified to the recipients,',
            'To object to an outcome against you produced solely by automated analysis,',
            'To claim compensation for damage caused by unlawful processing.',
          ],
          paragraphs: [
            'You can ask for a copy of your account data (your personal quizzes included) and for the deletion of your account by writing to the support address; we answer free of charge within 30 days. If you answered a Blind Quiz, your invite link shows your answers and lets you delete all of them yourself.',
          ],
        },
        {
          heading: '8. Children',
          paragraphs: [
            'The game is played under a nickname and asks for no identity. Minimum age for an account: [OWNER-TO-FILL]. We recommend that minors play under parental supervision.',
          ],
        },
        {
          heading: '9. Contact',
          paragraphs: [
            'For any privacy question or request: [OWNER-TO-FILL: e-mail address]. You may also complain to the Turkish Personal Data Protection Authority.',
          ],
        },
      ],
    },
    terms: {
      title: 'Terms of use',
      status: 'Draft · last updated 19 Oct 2026',
      sections: [
        {
          heading: '1. The service',
          paragraphs: [
            'QuizNight is a party quiz game played on a TV or computer screen with phones as controllers. Provided by: [OWNER-TO-FILL: name / company name, address]. By using the game you accept these terms.',
          ],
        },
        {
          heading: '2. Free game and possible paid features',
          paragraphs: [
            'The game is currently free. Should optional paid features be offered later, their price, content, withdrawal right and refund terms are shown clearly before purchase and separate terms that follow consumer law apply [OWNER-TO-FILL: seller details, distance-sales and pre-contract information texts].',
          ],
        },
        {
          heading: '3. Rules',
          items: [
            'Do not use insults, hate speech, harassment, someone else’s personal data or illegal content in nicknames, "Who Said It" statements or personal quizzes.',
            'When you make a Blind Quiz, invite only people who agree to it, and do not share an invite link with anyone else.',
            'Do not try to disrupt the game, cheat, overload the server or access other people’s accounts.',
            'Content that breaks the rules may be removed; a player may be removed from a room and an account or device may be blocked for a time or for good.',
          ],
        },
        {
          heading: '4. Content and trademarks',
          paragraphs: [
            'Questions are for information and fun; we take care that they are right but do not guarantee that they are free of mistakes. You can report a wrong question from inside the game.',
            'QuizNight is not affiliated with, endorsed or sponsored by the owners of the films, series, books or brands mentioned in its questions; names are used only to describe the topic of the questions. All trademarks belong to their respective owners.',
            'Whoever writes a personal quiz is responsible for its content.',
          ],
        },
        {
          heading: '5. Liability',
          paragraphs: [
            'The service is provided "as is"; it is not guaranteed to run without interruption or error. To the extent the law allows, no liability is accepted for indirect damage [OWNER-TO-FILL: wording approved by counsel].',
          ],
        },
        {
          heading: '6. Changes, governing law',
          paragraphs: [
            'If these terms change, the current text is published on this page. Turkish law applies; consumer arbitration committees and consumer courts have jurisdiction over disputes [OWNER-TO-FILL].',
          ],
        },
      ],
    },
    support: {
      title: 'Support',
      status: 'Draft · last updated 19 Oct 2026',
      sections: [
        {
          heading: 'Contact us',
          paragraphs: [
            'E-mail: [OWNER-TO-FILL: support e-mail address]. We usually answer within [OWNER-TO-FILL: time].',
            'It helps if you include: the room code (if any), your device and browser, and roughly when it happened. Never send a password, a sign-in code or an invite link.',
          ],
        },
        {
          heading: 'Common questions',
          items: [
            'My phone cannot connect: check that you opened the same address as the TV and typed the room code correctly; reloading the page brings you back into the room.',
            'A wrong or inappropriate question: use the "Report question" button on your phone once the answer is shown.',
            'I want to delete my Blind Quiz answers: open your invite link and press "Delete all my answers".',
            'A copy of my account data or deleting my account: write to the support address from the e-mail address of your account (Privacy page, section 7).',
          ],
        },
      ],
    },
  },
};

export const legal: Record<Locale, LegalCatalog> = { tr, en };
