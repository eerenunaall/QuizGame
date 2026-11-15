// Venue question sets (ADR-0025): the owner's upload page and the per-row explanations. Generated once, edited by hand.
export const venueContentTr = {
  'venue.issue.file_empty': 'Dosya boş. Soruların olduğu bir dosya seç.',
  'venue.issue.file_no_rows': 'Dosyada başlıktan başka satır yok. Başlığın altına soruları ekle.',
  'venue.issue.file_too_large':
    'Dosya çok büyük (en fazla {maxMb} MB). Soruları birkaç dosyaya böl.',
  'venue.issue.file_binary':
    'Bu bir metin dosyası değil. Soruları CSV veya JSONL (düz metin) olarak kaydet.',
  'venue.issue.file_excel':
    'Excel dosyaları (.xlsx, .xls) yüklenemez. Excel\'de Dosya > Farklı Kaydet > "CSV UTF-8" seç ve onu yükle.',
  'venue.issue.file_not_text':
    'Dosyanın karakterleri okunamadı. UTF-8 olarak kaydedip tekrar dene.',
  'venue.issue.file_json_array':
    'Dosya tek bir JSON listesi. Her soru ayrı bir satırda olmalı (JSONL) ya da CSV kullan.',
  'venue.issue.file_too_many_rows':
    'Dosyada en fazla {max} soru olabilir. Dosyayı bölüp ayrı ayrı yükle.',
  'venue.issue.file_cell_too_long':
    '{line}. satırda çok uzun bir hücre var (en fazla {max} karakter). Metni kısalt.',
  'venue.issue.file_csv_syntax':
    '{line}. satırda tırnak işareti hatalı. Metinde tırnak varsa hücreyi çift tırnak içine al ve içerideki tırnağı iki kez yaz.',
  'venue.issue.file_missing_columns':
    'Başlıkta şu sütunlar yok: {columns}. Şablondaki başlığı aynen kullan.',
  'venue.issue.file_encoding_fallback':
    'Dosya UTF-8 değildi, Windows Türkçe (1254) olarak okundu. Harfler yanlışsa Excel\'de "CSV UTF-8" olarak kaydet.',
  'venue.issue.invalid_json':
    'Bu satır geçerli bir JSON değil. Tırnakları ve virgülleri kontrol et.',
  'venue.issue.line_too_long': 'Bu satır çok uzun. Soruyu ve açıklamayı kısalt.',
  'venue.issue.row_not_object':
    'Bu satır bir soru nesnesi değil. Her satır { ... } biçiminde olmalı.',
  'venue.issue.too_many_cells':
    'Bu satırda başlıktan fazla hücre var. Metindeki virgülleri tırnak içine al.',
  'venue.issue.option_gap':
    'Şıklar sırayla doldurulmalı (A, B, C, D). Boş bir şıkkın ardından dolu şık olmaz.',
  'venue.issue.unknown_field': 'Tanınmayan alan: {name}. Alan adını şablondaki gibi yaz ya da sil.',
  'venue.issue.question_missing': 'Soru metni yok. "question" alanını doldur.',
  'venue.issue.question_too_short': 'Soru çok kısa (en az {min} karakter). Soruyu açık ve tam yaz.',
  'venue.issue.question_too_long': 'Soru çok uzun ({len} karakter, en fazla {max}). Kısalt.',
  'venue.issue.options_missing': 'Şıklar yok. En az iki şık yaz (genelde dört).',
  'venue.issue.options_too_few':
    'Şık sayısı yetersiz ({have}). En az {min} şık gerekir, tercihen dört.',
  'venue.issue.options_too_many': 'Çok fazla şık. En fazla {max} şık olabilir, tercihen dört.',
  'venue.issue.option_empty': '{n}. şık boş. Doldur ya da sondaki boş şıkları sil.',
  'venue.issue.option_too_long':
    '{n}. şık çok uzun ({len} karakter, en fazla {max}). Telefonda sığması için kısalt.',
  'venue.issue.correct_missing': 'Doğru şık belirtilmemiş. "correct" sütununa A, B, C veya D yaz.',
  'venue.issue.correct_out_of_range':
    'Doğru şık, şıkların dışında. Bu soruda {count} şık var; doğru şık bunlardan biri olmalı.',
  'venue.issue.difficulty_missing':
    'Zorluk yok. EASY, MEDIUM, HARD veya EXPERT yaz (kolay, orta, zor, uzman da olur).',
  'venue.issue.difficulty_invalid':
    'Zorluk anlaşılmadı. EASY, MEDIUM, HARD veya EXPERT yaz (kolay, orta, zor, uzman da olur).',
  'venue.issue.category_missing':
    'Kategori yok. Hazır kategorilerden birini ya da kafeye özel bir ad yaz.',
  'venue.issue.category_invalid':
    'Kategori adı geçersiz. En çok {max} karakter, harf ve rakamlardan oluşan, uygun bir ad yaz.',
  'venue.issue.category_limit':
    'Kafeye özel en fazla {max} kategori olabilir. Bu soruyu mevcut bir kategoriye al.',
  'venue.issue.explanation_too_long': 'Açıklama çok uzun ({len} karakter, en fazla {max}). Kısalt.',
  'venue.issue.source_invalid_url':
    'Kaynak adresi geçersiz. http:// veya https:// ile başlayan tam adres yaz ya da boş bırak.',
  'venue.issue.language_invalid': 'Dil anlaşılmadı. tr veya en yaz ya da sütunu boş bırak.',
  'venue.issue.author_invalid': 'Yazar türü geçersiz. Bu alanı silebilirsin.',
  'venue.issue.text_too_long': 'Alt kategori ya da konu çok uzun (en fazla {max} karakter).',
  'venue.issue.text_forbidden_characters':
    'Metinde görünmeyen ya da yön değiştiren karakterler var. Metni düz yazı olarak yeniden yaz.',
  'venue.issue.text_profanity':
    'Metinde uygunsuz bir ifade var. Bu soru alınmaz; ifadeyi değiştir.',
  'venue.issue.row_invalid': 'Bu satırda bir sorun var ({field}). Şablondaki biçime göre düzelt.',
  'venue.issue.venue_full':
    'Kafenizin soru sınırı doldu (en fazla {max}). Eski bir yüklemeyi kaldırın.',
  'venue.issue.duplicate': 'Bu soru zaten var (kafenizde ya da ortak havuzda). Atlanır.',
  'venue.issue.duplicate_in_file': 'Bu soru dosyada {line}. satırda da var. Atlanır.',
  'venue.issue.conflicting_duplicate':
    'Aynı soru başka bir doğru cevapla zaten var. Hangisi doğruysa onu bırak. Atlanır.',
  'venue.issue.near_duplicate':
    'Bu soru, var olan bir soruya çok benziyor. Atlanır; gerçekten farklıysa soruyu yeniden yaz.',
  'venue.issue.NO_CORRECT_OPTION': 'Doğru cevap şıklar arasında yok. Doğru şıkkı ekle.',
  'venue.issue.MULTIPLE_CORRECT_OPTIONS': 'Birden fazla doğru şık var. Yalnızca biri doğru olsun.',
  'venue.issue.OPTION_COUNT_NONSTANDARD': 'Şık sayısı dört değil. Dört şık yaz.',
  'venue.issue.DUPLICATE_OPTIONS': 'İki şık aynı. Farklı şıklar yaz.',
  'venue.issue.OPTIONS_NEARLY_IDENTICAL':
    'İki şık birbirine çok benziyor. Daha ayırt edilebilir şıklar yaz.',
  'venue.issue.OVERLAPPING_OPTIONS':
    'Şıklardan biri diğerinin içinde geçiyor; iki cevap da doğru sayılabilir. Şıkları netleştir.',
  'venue.issue.ALL_OR_NONE_OPTION': '"Hepsi" ya da "hiçbiri" gibi bir şık var. Bunları kaldır.',
  'venue.issue.NEGATIVE_STEM': 'Soru olumsuz sorulmuş ("değildir"). Olumlu sor.',
  'venue.issue.DOUBLE_NEGATIVE': 'Soruda çift olumsuzluk var. Sadeleştir.',
  'venue.issue.ABSOLUTE_CLAIM':
    '"Her zaman", "asla" gibi kesin ifadeler var. Daha net bir olgu sor.',
  'venue.issue.ANSWER_IN_QUESTION': 'Cevap soru metninde geçiyor. Cevabı sorudan çıkar.',
  'venue.issue.ANSWER_STEM_IN_QUESTION': 'Cevabın bir kısmı soruda geçiyor. Soruyu yeniden yaz.',
  'venue.issue.LENGTH_CLUE_STRONG':
    'Doğru şık diğerlerinden belirgin biçimde uzun/kısa; bu cevabı ele veriyor. Şıkları benzer uzunlukta yaz.',
  'venue.issue.LENGTH_CLUE':
    'Doğru şıkkın uzunluğu diğerlerinden farklı. Şıkları benzer uzunlukta yaz.',
  'venue.issue.FORMAT_CLUE':
    'Yalnızca doğru şıkta bir biçim özelliği var (büyük harf, rakam, tırnak). Şıkları aynı biçimde yaz.',
  'venue.issue.OPTION_TYPE_MISMATCH':
    'Şıklar farklı türde (biri sayı, biri kelime gibi). Aynı türden şıklar yaz.',
  'venue.issue.NUMERIC_SCALE_MISMATCH':
    'Sayısal şıkların büyüklükleri çok farklı. Yakın değerler yaz.',
  'venue.issue.BROKEN_ENCODING': 'Metinde bozuk karakterler var. Dosyayı UTF-8 olarak kaydet.',
  'venue.issue.INVALID_CHARACTERS': 'Metinde geçersiz karakterler var. Düz yazı kullan.',
  'venue.issue.PLACEHOLDER_TEXT':
    'Metinde yer tutucu var ("lorem", "xxx", "..."). Gerçek metni yaz.',
  'venue.issue.ASCII_FOLDED_TURKISH':
    'Türkçe karakterler eksik (ç ğ ı ö ş ü). Doğru yazımla yeniden yaz.',
  'venue.issue.TYPOGRAPHY': 'Yazımda küçük bir bozukluk var (fazla boşluk, noktalama). Düzelt.',
  'venue.issue.STEM_MISSING_QUESTION_MARK': 'Soru işareti yok. Soruyu "?" ile bitir.',
  'venue.issue.STEM_LOWERCASE_START': 'Soru küçük harfle başlıyor. Büyük harfle başla.',
  'venue.issue.OPTION_PUNCTUATION_INCONSISTENT':
    'Şıklarda noktalama tutarsız (biri nokta ile bitiyor). Hepsini aynı yaz.',
  'venue.issue.PROFANITY': 'Uygunsuz ifade var. Bu soru alınmaz.',
  'venue.issue.SENSITIVE_TOPIC':
    'Hassas bir konuya değiniyor (siyaset, din gibi). Daha tarafsız bir soru yaz.',
  'venue.issue.LINK_IN_TEXT':
    'Metinde bağlantı var. Bağlantıyı sil; kaynak için "sourceUrl" sütununu kullan.',
  'venue.issue.EMOJI_IN_TEXT': 'Metinde emoji var. Kaldır.',
  'venue.issue.SHOUTING': 'Metin büyük harflerle yazılmış. Normal yaz.',
  'venue.issue.CONVERSATIONAL_FILLER': 'Sohbet dili var ("Peki", "Hadi bakalım"). Doğrudan sor.',
  'venue.issue.STEM_PARENTHETICAL': 'Soruda parantez içi açıklama var. Sadeleştir.',
  'venue.issue.STEM_TOO_SHORT': 'Soru çok kısa. Daha açık yaz.',
  'venue.issue.STEM_TOO_LONG': 'Soru çok uzun. Kısalt.',
  'venue.issue.OPTION_TOO_LONG': 'Bir şık çok uzun; telefonda sığmaz. Kısalt.',
  'venue.issue.EXPLANATION_TOO_LONG': 'Açıklama çok uzun. Bir iki cümleye indir.',
  'venue.issue.MISSING_EXPLANATION': 'Açıklama yok (zorunlu değil ama önerilir).',
  'venue.issue.LLM_STYLE_PHRASES':
    'Metin yapay zekâ kalıpları taşıyor ("elbette", "işte"). İnsan gibi yeniden yaz.',
  'venue.issue.LONG_QUOTE': 'Uzun bir alıntı var. Kendi cümlenle yaz.',
  'venue.issue.PROMPT_INJECTION_SUSPECT':
    'Metin bir yapay zekâya talimat veriyormuş gibi. Bu soru alınmaz.',
  'venue.issue.REPEATED_OPENER': 'Birçok soru aynı sözlerle başlıyor. Çeşitlendir.',
  'venue.issue.AMBIGUOUS_TEMPORAL':
    '"Şu an", "en son" gibi zamana bağlı ifade var. Sabit bir tarih ya da olgu sor.',
  'venue.issue.RECENT_EVENT_AS_EVERGREEN':
    'Güncel bir olay gibi görünüyor; zamanla yanlış olabilir. Kalıcı bir olgu sor.',
  'venue.issue.EXPIRED': 'Sorunun süresi geçmiş.',
  'venue.issue.STALE_VERIFICATION': 'Doğrulama tarihi çok eski.',
  'venue.issue.REVERIFY_DUE': 'Yeniden doğrulama zamanı gelmiş.',
  'venue.issue.EXPIRY_SOON': 'Sorunun süresi yakında dolacak.',
  'venue.issue.NEVER_VERIFIED': 'Doğrulama tarihi yok.',
  'venue.issue.SOURCE_REQUIRED_MISSING': 'Bu kategori için kaynak gerekiyor.',
  'venue.issue.CATEGORY_MISMATCH_SUSPECT':
    'Soru seçilen kategoriye uymuyor olabilir. Kategoriyi kontrol et.',
  'venue.issue.TEMPLATE_REPEAT': 'Aynı kalıpla çok soru var. Çeşitlendir.',
  'venue.issue.DUPLICATE_LEXICAL': 'Bu soru zaten var. Atlanır.',
  'venue.issue.CONFLICTING_DUPLICATE': 'Aynı soru başka bir cevapla var. Atlanır.',
  'venue.issue.NEAR_DUPLICATE': 'Var olan bir soruya çok benziyor. Atlanır.',
  'venue.issue.SIMILAR_QUESTION':
    'Var olan bir soruya benziyor. Gerçekten farklı bir soru olduğundan emin ol ve yeniden yaz.',
  'venue.issue.POSSIBLE_SEMANTIC_DUPLICATE':
    'Anlamca var olan bir soruya yakın. Farklı bir olgu sor.',
  'venue.issue.FACT_CHECK_NOT_RUN': 'Doğrulama yapılamadı.',
  'venue.issue.FACT_CHECK_REVIEW': 'Bilgi doğrulaması gerekiyor.',
  'venue.issue.SCORES_MISSING': 'Kalite puanları eksik.',
  'venue.issue.SCORE_BELOW_MINIMUM': 'Kalite puanı yetersiz.',
  'staff.tab.questions': 'Sorular',
  'vq.title': 'Kafenin soruları',
  'vq.intro':
    'Buraya yüklediğin sorular yalnızca bu kafenin masalarında çıkar; başka kafelerde ya da herkese açık oyunda görünmez.',
  'vq.totals':
    '{active} soru yayında · {review} incelemede · {retired} kaldırıldı (üst sınır {max})',
  'vq.empty': 'Henüz soru yüklenmedi.',
  'vq.staffOnly': 'Soru yüklemeyi yalnızca kafe sahibi yapabilir. Burada sayıları görebilirsin.',
  'vq.categories': 'Kategoriye göre',
  'vq.uploads': 'Yüklemeler',
  'vq.upload.line': '{name} · {imported} soru · {when}',
  'vq.upload.active': '{count} yayında',
  'vq.upload.retired': 'Kaldırıldı',
  'vq.upload.remove': 'Bu yüklemeyi kaldır',
  'vq.upload.removeConfirm': 'Emin misin? Bu yüklemedeki {count} soru oyundan çıkar. Tekrar dokun.',
  'vq.upload.removed': 'Yükleme kaldırıldı: {count} soru oyundan çıktı.',
  'vq.load.title': 'Soru yükle',
  'vq.load.file': 'Dosya seç (CSV veya JSONL)',
  'vq.load.paste': 'ya da soruları buraya yapıştır',
  'vq.load.pasteHint': 'CSV (başlık satırıyla) ya da satır başına bir JSON.',
  'vq.load.check': 'Kontrol et',
  'vq.load.checking': 'Kontrol ediliyor…',
  'vq.help.title': 'Dosyayı nasıl hazırlarım?',
  'vq.help.body':
    "Şablonu indir ya da hazır yazıyı bir yapay zekâ asistanına yapıştır; konuyu ve soru sayısını yaz, çıkan CSV'yi yükle. Yüklenen her soru önce otomatik denetlenir.",
  'vq.help.csv': 'CSV şablonunu indir',
  'vq.help.jsonl': 'JSONL örneğini indir',
  'vq.help.prompt': 'Yapay zekâya yapıştırılacak yazıyı kopyala',
  'vq.help.copied': 'Kopyalandı. Yapay zekâ asistanına yapıştır.',
  'vq.help.copyFailed': 'Kopyalanamadı; metin aşağıda, elle seçip kopyala.',
  'vq.report.title': 'İçe aktarma raporu (henüz kaydedilmedi)',
  'vq.report.done': 'İçe aktarıldı',
  'vq.report.already': 'Bu dosya zaten yüklenmiş ({when}, {count} soru). Değişen bir şey olmadı.',
  'vq.report.ok': '{count} soru yayına girecek',
  'vq.report.okDone': '{count} soru yayına alındı',
  'vq.report.review': '{count} soru düzeltme bekliyor',
  'vq.report.reject': '{count} soru reddedildi',
  'vq.report.invalid': '{count} satır okunamadı',
  'vq.report.duplicate': '{count} tekrar (atlandı)',
  'vq.report.full': '{count} soru sınır nedeniyle alınmadı',
  'vq.report.newCategories': 'Yeni kategori: {names}',
  'vq.report.byCategory': '{label}: {count}',
  'vq.report.problems': 'Düzeltilmesi gereken satırlar',
  'vq.report.row': 'Satır {line}',
  'vq.report.status.REVIEW': 'Düzelt ve yeniden yükle',
  'vq.report.status.REJECT': 'Reddedildi',
  'vq.report.status.INVALID': 'Okunamadı',
  'vq.report.status.DUPLICATE': 'Tekrar',
  'vq.report.status.FULL': 'Sınır',
  'vq.report.more': '{count} satır daha var, listede gösterilmiyor.',
  'vq.report.sample': 'Yayına girecek ilk sorular',
  'vq.report.nothing': 'Yayına girecek soru yok. Önce yukarıdaki sorunları düzelt.',
  'vq.report.import': 'İçe aktar',
  'vq.report.importing': 'İçe aktarılıyor…',
  'vq.report.batchSkew': 'Doğru şıkların yerleri dengesiz dağılmış; dengelemek iyi olur.',
  'vq.report.batchLongest': 'Doğru şık çoğunlukla en uzun şık; şık uzunluklarını dengele.',
  'vq.export': 'Soruları CSV olarak indir',
  'vq.source.title': 'Soru kaynağı',
  'vq.source.MIXED': 'Karışık (kafenin soruları + ortak havuz)',
  'vq.source.VENUE_ONLY': 'Yalnızca kafenin soruları (yetmezse havuzdan tamamlanır)',
  'vq.source.GLOBAL_ONLY': 'Yalnızca ortak havuz',
  'vq.source.share': 'Karışık modda kafenin payı (%)',
  'vq.reports.title': 'Oyuncu bildirimleri',
  'vq.reports.none': 'Açık bildirim yok.',
  'vq.reports.dismiss': 'Yoksay',
  'vq.reports.retire': 'Soruyu kaldır',
  'vq.reports.reason.WRONG_ANSWER': 'Yanlış cevap',
  'vq.reports.reason.MULTIPLE_CORRECT': 'Birden fazla doğru',
  'vq.reports.reason.OUTDATED': 'Eskimiş',
  'vq.reports.reason.TYPO': 'Yazım hatası',
  'vq.reports.reason.OFFENSIVE': 'Uygunsuz',
  'vq.reports.reason.UNCLEAR': 'Belirsiz',
  'vq.reports.reason.DUPLICATE': 'Tekrar',
  'vq.reports.reason.OTHER': 'Diğer',
  'vq.error.generic': 'İşlem yapılamadı. Tekrar dene.',
  'vq.error.throttled': 'Çok sık yükleme denendi. Biraz bekleyip tekrar dene.',
  'vq.error.forbidden': 'Bu işlem için kafe sahibi olmalısın.',
  'vq.error.limit': 'Kafenin soru sınırı doldu.',
  'vq.error.fileRead': 'Dosya okunamadı.',
} as const;
