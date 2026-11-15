# İnternetten açılan demo (indirme yok, tarayıcıdan)

Amaç: bir internet adresi (ör. `https://quiznight-demo.onrender.com`). TV'de `/tv` açılır, telefonlar QR ile girer.
Kod indirmek, `pnpm` veya laptop kurulumu gerekmez. Servis: Render (render.com). Bu yapılandırma burada hazırlandı
ama **Docker olmadığı için bu ortamda derlenip denenmedi**; ilk kurulumda hata çıkarsa Render'daki "Logs" metnini bana yapıştır.

## Adımlar (yaklaşık 15 dakika, ilk derleme dahil)
1. https://render.com adresinde GitHub hesabınla kayıt ol (Sign in with GitHub).
2. Render'ın GitHub'a erişmesine izin ver ve **QuizGame** reposunu seç (repo özel olduğu için bu izin gerekir).
3. Sağ üstte **New +** > **Blueprint** > repoyu seç > dal olarak `claude/cloud-session-infrastructure-ln57mp` yaz.
4. Render `render.yaml` dosyasını okur ve iki şey oluşturur: ücretsiz veritabanı ve oyun sunucusu. **Apply**'a bas.
5. Sunucu "Live" olunca (ilk seferde 5-10 dk) üstteki adrese tıkla. Sonuna `/tv` ekle: TV ekranı budur.
6. Telefonlar TV'deki QR kodu okutur (adres otomatik doğru gelir). Kült diziler kategorisi lobide görünür.

## Demodan önce bilmen gerekenler
- **Ücretsiz plan uyur:** 15 dakika kullanılmazsa kapanır, ilk açılış ~1 dakika sürer. Demodan 5 dakika önce adresi aç.
  Kesintisiz çalışsın istersen Render'da sunucuyu ücretli en küçük plana al (ayda yaklaşık 7 dolar).
- Ücretsiz veritabanı süreli olabilir (Render koşulları değişebilir); demo için sorun değil.
- Güvenlik: bu kurulum yalnızca demo içindir (geliştirme modu ve deneme soruları). Gerçek yayın için başka ayar gerekir
  (`docs/DEPLOYMENT.md` hazırlanıyor). Adresi herkese yayma.
- Siyah-altın temayı görmek için adresin sonuna `?theme=venue-gold` ekle.
