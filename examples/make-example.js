// Maakt een voorbeeld-Excel om de plugin mee te testen.
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');

const rows = [
  ['id', 'titel', 'subtitel', 'prijs', 'cta', 'foto'],
  ['p01', 'Zomer in Gent', 'Festivalpakket voor 2 personen', '€ 49', 'Boek nu', 'https://picsum.photos/id/1011/1200/1200'],
  ['p02', 'Stadswandeling', 'Ontdek de verborgen hoekjes', '€ 15', 'Reserveer', 'https://picsum.photos/id/1031/1200/1200'],
  ['p03', 'Koffie & taart', 'Elke zondag in het atelier', '€ 9', 'Kom langs', 'https://picsum.photos/id/1060/1200/1200'],
  ['p04', 'Fietsverhuur', 'Een hele dag langs de Leie', '€ 12', 'Huur nu', 'https://picsum.photos/id/1070/1200/1200'],
  ['p05', 'Workshop foto', 'Leer werken met natuurlijk licht', '€ 65', 'Schrijf in', 'https://picsum.photos/id/250/1200/1200'],
];
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [{ wch: 6 }, { wch: 18 }, { wch: 34 }, { wch: 8 }, { wch: 12 }, { wch: 44 }];
XLSX.utils.book_append_sheet(wb, ws, 'Campagne');
const out = path.join(__dirname, 'voorbeeld-campagne.xlsx');
require('fs').writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log('✓ ' + out);
