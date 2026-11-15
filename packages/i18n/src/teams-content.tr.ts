// Teams and the simple ruleset ("Basit mod", ADR-0026). Turkish is the source of truth; the English twin must match key for key.
export const teamsContentTr = {
  // The team slots: names are ours, players never type one (a venue may rename a slot in its settings).
  'team.tiger': 'Kaplanlar',
  'team.owl': 'Baykuşlar',
  'team.fox': 'Tilkiler',
  'team.lion': 'Aslanlar',
  'team.bear': 'Ayılar',
  'team.dragon': 'Ejderhalar',
  'team.whale': 'Balinalar',
  'team.penguin': 'Penguenler',

  // Settings (leader on the phone, TV settings)
  'teams.mode.title': 'Oyun şekli',
  'teams.mode.INDIVIDUAL': 'Bireysel',
  'teams.mode.TEAMS': 'Takım',
  'teams.ruleset.title': 'Kurallar',
  'teams.ruleset.FULL': 'Tam',
  'teams.ruleset.SIMPLE': 'Basit',
  'teams.ruleset.SIMPLE.hint': 'Az güç, kolay kurallar: 50/50, Çifte Hak ve üç sabotaj.',
  'teams.count.title': 'Takım sayısı',

  // Lobby
  'teams.pick.title': 'Takımını seç',
  'teams.pick.hint': 'Bir takıma dokun. Arkadaşların aynı takıma geçsin.',
  'teams.yours': 'Takımın: {team}',
  'teams.full': 'Dolu',
  'teams.members_one': '{count} kişi',
  'teams.members_other': '{count} kişi',
  'teams.empty': 'Henüz kimse yok',
  'teams.balance.ok': 'Takımlar dengeli',
  'teams.balance.bad':
    'Takımlar dengesiz: {big} ile {small} arasında çok fark var. Birkaç oyuncuyu taşıyın.',
  'teams.balance.few': 'En az iki takımda oyuncu olmalı.',
  'teams.tv.pick': 'Takımını telefonundan seç',
  'teams.manage.move': '{name} için takım seç',
  'teams.rule.score': 'Takımlar, oyuncu başına ortalama puanla sıralanır.',

  // Scores and results
  'teams.score.title': 'TAKIM PUANLARI',
  'teams.average': 'ort. {points}',
  'teams.avgLabel': 'ORTALAMA',
  'teams.total': 'toplam {points}',
  'teams.phone.rank': 'Takımın {rank}. sırada',
  'teams.phone.average': 'Takım ortalaması: {points}',
  'teams.results.winner': '{team} kazandı!',
  'teams.results.players': 'Oyuncular',
  'teams.reward.tv': '{team} kazandı! Ödül kodu {name} adlı oyuncunun telefonunda.',
  'teams.reward.phone': 'Takımınızın ödülü: kodu kasada göster.',

  // Sabotage aimed at a team
  'teams.target.title': 'Hangi takıma?',
  'teams.target.hint': 'Takımın bütün oyuncuları etkilenir.',
  'tv.power.sabotage.team': '{actor} → {team}',

  // Simple ruleset prep phase
  'ctl.simple.title': 'HAZIRLAN',
  'ctl.simple.rule': 'Gücünü seç, sonra TAMAM de.',
  'ctl.simple.dd.hint': 'Doğruysa puanın 2 katı. Yanlışsa ceza.',
  'ctl.simple.dd.on': 'Çifte Hak açık',
  'ctl.simple.sab.title': 'Rakibe sabotaj',
  'ctl.simple.sab.pickTeam': 'Hangi takıma?',
  'ctl.simple.sab.pickPlayer': 'Kime?',
  'ctl.simple.done': 'TAMAM',
  'ctl.simple.sending': 'Gönderiliyor…',
  'ctl.simple.ready': 'Hazırsın!',
  'ctl.simple.nothing': 'Bu turda kullanacağın güç yok.',
  'ctl.simple.waiting': 'Diğerleri karar veriyor…',
  'ctl.simple.hasToken': '{count} jeton',
  'tv.simple.title': 'HAZIRLAN',
  'tv.simple.rule': 'Telefonunda gücünü seç: Çifte Hak ya da bir rakibe sabotaj.',
  'tv.simple.menu': 'Sabotajlar: {list}',

  // Errors
  'error.TEAM_FULL': 'Bu takım dolu.',
  'error.TEAM_INVALID': 'Bu takım seçilemez.',
  'error.TEAMS_UNBALANCED': 'Takımlar dengesiz: bazı oyuncuları başka takıma taşıyın.',
  'error.NOT_ENOUGH_TEAMS': 'Başlamak için en az iki takımda oyuncu olmalı.',

  // Venue settings (owner, /staff)
  'staff.play.title': 'Oyun şekli ve kurallar',
  'staff.play.mode': 'Varsayılan oyun şekli',
  'staff.play.simple': 'Basit kurallar (az güç)',
  'staff.play.window': 'Basit kurallarda cevap süresi (sn, boş = 30)',
  'staff.play.names': 'Takım adları (boş bırakılan varsayılan adı kullanır)',
  'staff.play.name': '{n}. takım adı',
} as const;
