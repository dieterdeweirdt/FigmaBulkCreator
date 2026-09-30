# Bulk Creator — Figma plugin

Maak in één klik tientallen varianten van een ontwerp (social posts, stories, banners…) op basis van een Excel- of CSV-bestand.

## Installeren (development plugin)

1. Download of clone deze repository: `git clone https://github.com/dieterdeweirdt/FigmaBulkCreator.git`
   (of via GitHub: **Code → Download ZIP**). De gebouwde plugin zit al in `dist/`, Node is dus niet nodig.
2. Figma desktop → **Plugins → Development → Import plugin from manifest…** → kies `manifest.json`.
3. Start via **Plugins → Development → Bulk Creator**.

Pas je zelf iets aan in `src/`, voer dan `npm run build` uit (Node vereist). `npm run watch` bouwt automatisch opnieuw bij elke wijziging in `src/`.
`npm run example` maakt `examples/voorbeeld-campagne.xlsx` om mee te testen.

## Werkwijze

1. **Templates** — selecteer één of meer frames (bv. post, story, banner). Ze verschijnen meteen in de plugin.
   Selecteer je later iets anders, dan vraagt de plugin of je die selectie wil gebruiken of toevoegen.
2. **Data** — sleep een `.xlsx`, `.xls` of `.csv` in de plugin. De eerste gevulde rij bevat de kolomnamen.
   Kies eventueel een ander werkblad en vink rijen uit die je niet wil.
3. **Koppelen** — kolommen worden automatisch aan lagen gekoppeld. Lukt dat niet, kies de laag in de lijst
   of klik op ◎ en klik de laag aan op het canvas. Klik op het icoontje vóór een kolom om te wisselen tussen tekst en afbeelding.
4. **Afbeeldingen** — verschijnt enkel als de Excel naar bestandsnamen verwijst: sleep dan de map met foto's erin.
5. **Genereer** (of `⌘/Ctrl + Enter`).

## Hoe de Excel eruit kan zien

| id  | titel          | subtitel                   | prijs | foto                                 |
|-----|----------------|----------------------------|-------|--------------------------------------|
| p01 | Zomer in Gent  | Festivalpakket voor 2      | € 49  | https://…/zomer.jpg                  |
| p02 | Stadswandeling | Ontdek de verborgen hoekjes| € 15  | wandeling.jpg                        |

Afbeeldingen mogen zijn:
- een **URL** (de server moet externe toegang toelaten; Dropbox-links worden automatisch omgezet),
- een **bestandsnaam** (`wandeling.jpg` of `fotos/wandeling.jpg`) — de foto's voeg je toe in stap 4,
- een **afbeelding in de Excel zelf**: via *Invoegen → Afbeelding → In cel plaatsen* of een zwevende afbeelding in de cel.

## Automatisch koppelen

Een kolom wordt gekoppeld aan een laag als:
- de laagnaam gelijk is aan de kolomnaam (`titel`, `#titel`, `Titel` — hoofdletters en tekens tellen niet),
- de tekst in de laag een placeholder bevat (`{{titel}}`, `{titel}`, `[titel]`),
- ze synoniemen zijn (titel/title/headline, prijs/price, cta/button/knop, foto/image/afbeelding, …),
- er één beeldkolom is: dan kiest de plugin de grootste laag met een afbeelding die geen logo of icoon is.

Eén kolom kan **meerdere lagen** vullen: kies via **+ laag** (of ◎) een extra laag. Handig om een profielfoto
zowel als avatar als als wazige achtergrond te gebruiken — de blur zet je gewoon als *Layer blur* op die laag in de template.
Lagen met dezelfde naam als de kolom (bv. `foto` en `foto blur`) worden automatisch allebei gekoppeld.

Tekstkolommen gaan naar tekstlagen. Beeldkolommen vervangen de **image fill** van een laag (rechthoek, ellips, frame…);
heeft de laag nog geen image fill, dan wordt er een toegevoegd.

## Waar komen de varianten?

Per template komt er een **frame** onder de templates (handig om in één keer te exporteren), met alle varianten naast elkaar. Meerdere templates
staan onder elkaar, in dezelfde volgorde als op het canvas. Tussenruimte en "varianten per rij" stel je in bij *Opties*.

## Template aanpassen → varianten passen mee aan

Standaard wordt je frame omgezet naar een **component** en zijn de varianten **instances**. Alles wat je aan de
template verandert (kleuren, lettertype, positie, extra lagen…) komt dus automatisch in alle varianten.
Wat uit de Excel komt (tekst, foto) blijft per variant behouden.

Wordt een template groter of kleiner terwijl de plugin open staat, dan worden de varianten automatisch
opnieuw uitgelijnd. Anders: klik op **Herschik** bij de set.

## Dezelfde Excel opnieuw uploaden

De plugin onthoudt per template welke Excel (bestandsnaam of dezelfde kolommen) gebruikt werd, de koppeling en
welke variant bij welke rij hoort. Upload je dezelfde Excel opnieuw, dan kies je:
- **Bestaande varianten bijwerken** — rijen worden herkend via de rij-sleutel (kolom `id`, anders de eerste unieke kolom, anders het rijnummer; aanpasbaar bij *Opties*). Nieuwe rijen krijgen een nieuwe variant; optioneel worden varianten van verwijderde rijen gewist.
- **Nieuwe set maken** — de oude set blijft staan.

## Goed om te weten

- Ontbrekende lettertypes: lagen met een font dat niet geïnstalleerd is, worden overgeslagen (je krijgt een melding).
- Afbeeldingen groter dan 4096 px of in WebP/AVIF worden automatisch omgezet voor Figma.
- Lege cellen: kies bij *Opties* of de template-inhoud blijft, de laag leeg wordt of verborgen wordt.
- Een template die al een component is, blijft gewoon die component. Een component set zelf kan niet; kies één variant ervan.

## Structuur

```
manifest.json     Figma plugin manifest (wijst naar dist/)
src/code.js       Figma-kant: lagen lezen, varianten maken, layout
src/ui.html       Interface: Excel inlezen, koppelen, afbeeldingen ophalen
vendor/           SheetJS (Excel) en fflate (afbeeldingen uit .xlsx halen)
build.js          Bundelt alles tot dist/ui.html + dist/code.js
```
