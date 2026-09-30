// Creates an example Excel file to test the plugin with.
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');

const rows = [
  ['id', 'title', 'subtitle', 'price', 'cta', 'photo'],
  ['p01', 'Summer in Ghent', 'Festival package for two', '€ 49', 'Book now', 'https://picsum.photos/id/1011/1200/1200'],
  ['p02', 'City walk', 'Discover the hidden corners', '€ 15', 'Reserve', 'https://picsum.photos/id/1031/1200/1200'],
  ['p03', 'Coffee & cake', 'Every Sunday at the studio', '€ 9', 'Drop by', 'https://picsum.photos/id/1060/1200/1200'],
  ['p04', 'Bike rental', 'A full day along the river Leie', '€ 12', 'Rent now', 'https://picsum.photos/id/1070/1200/1200'],
  ['p05', 'Photo workshop', 'Learn to work with natural light', '€ 65', 'Sign up', 'https://picsum.photos/id/250/1200/1200'],
];
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [{ wch: 6 }, { wch: 18 }, { wch: 34 }, { wch: 8 }, { wch: 12 }, { wch: 44 }];
XLSX.utils.book_append_sheet(wb, ws, 'Campaign');
const out = path.join(__dirname, 'example-campaign.xlsx');
require('fs').writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log('✓ ' + out);
