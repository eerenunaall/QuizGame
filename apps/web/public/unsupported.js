/* Runs only in browsers without ES-module support (nomodule): plain ES5, no dependencies. */
(function () {
  var root = document.getElementById('root');
  if (!root) return;
  var lang = (navigator.language || 'tr').slice(0, 2) === 'en' ? 'en' : 'tr';
  var text = {
    tr: [
      'Bu tarayıcı desteklenmiyor',
      'Quiz Party için güncel bir tarayıcı gerekiyor.',
      "Chrome, Edge, Firefox veya Safari'nin güncel sürümünü deneyin ya da telefonunuzdan katılın.",
    ],
    en: [
      'This browser is not supported',
      'Quiz Party needs an up-to-date browser.',
      'Try a current Chrome, Edge, Firefox or Safari, or join from your phone.',
    ],
  }[lang];
  root.innerHTML = '';
  var box = document.createElement('div');
  box.className = 'qp-unsupported';
  var title = document.createElement('h1');
  title.appendChild(document.createTextNode(text[0]));
  box.appendChild(title);
  for (var i = 1; i < text.length; i++) {
    var line = document.createElement('p');
    line.appendChild(document.createTextNode(text[i]));
    box.appendChild(line);
  }
  root.appendChild(box);
})();
