// Gabarit commun des documents PDF (reçu, devis, facture, avoir), en français ou en arabe.
// Les données arrivent déjà formatées (montants, dates, libellés traduits) dans /data.json :
// le gabarit ne fait que la mise en page. Rendu déterministe : mêmes données, même PDF.
//
// Sens d'écriture : les nombres, dates, références et textes latins arrivent entourés d'isolats
// bidirectionnels Unicode (LRI … PDI) et restent dans l'ordre gauche-droite dans un document arabe.
// Les passages entre ⟦ et ⟧ sont, eux, posés dans une boîte insécable (codes courts uniquement).

#let data = json("/data.json")
#let rtl-doc = data.lang == "ar"
#let brand = rgb(data.at("brandColor", default: "#a0522d"))
#let muted = rgb("#6b6b6b")
#let line-color = rgb("#e4dcd3")
#let soft = rgb("#faf6f1")

#set document(title: data.title + " " + data.number, author: data.seller.name, date: none)
#set text(
  font: "IBM Plex Sans Arabic",
  lang: data.lang,
  dir: if rtl-doc { rtl } else { ltr },
  size: 9.5pt,
)
#set par(leading: 0.6em)

/// Passage posé de gauche à droite (boîte en ligne : direction indépendante du paragraphe).
#let ltr-run(body) = box(text(dir: ltr, body))

/// Texte avec passages ⟦…⟧ de gauche à droite.
#let rich(value) = {
  if type(value) != str { return value }
  let parts = value.split("⟦")
  parts.at(0)
  for part in parts.slice(1) {
    let pieces = part.split("⟧")
    ltr-run(pieces.at(0))
    pieces.slice(1).join("⟧")
  }
}

#let label(body) = text(fill: muted, size: 8pt, rich(body))

#set page(
  paper: "a4",
  margin: (x: 16mm, top: 14mm, bottom: 24mm),
  footer: context [
    #set text(size: 7.2pt, fill: muted)
    #line(length: 100%, stroke: 0.5pt + line-color)
    #grid(
      columns: (1fr, auto),
      gutter: 4mm,
      [#for line in data.footer [#rich(line) \ ]],
      [#counter(page).display("1 / 1", both: true)],
    )
  ],
)

// ─── Filigrane (document annulé) ───
#if data.at("watermark", default: none) != none {
  place(
    center + horizon,
    rotate(-30deg, text(size: 64pt, weight: "bold", fill: rgb(200, 40, 40, 40), data.watermark)),
  )
}

// ─── En-tête : vendeur et titre ───
#grid(
  columns: (1fr, auto),
  align: (start + top, end + top),
  gutter: 6mm,
  [
    #if data.at("hasLogo", default: false) {
      box(image("/logo.png", height: 16mm))
      h(3mm)
    }
    #box[
      #text(size: 13pt, weight: "bold")[#data.seller.name] \
      #for line in data.seller.lines [#text(fill: muted, size: 8.5pt)[#rich(line)] \ ]
    ]
  ],
  [
    #text(size: 19pt, weight: "bold", fill: brand)[#data.title] \
    #text(weight: "semibold")[#ltr-run(data.number)] \
    #for (key, value) in data.meta [#label(key) #rich(value) \ ]
  ],
)

#v(5mm)

// ─── Parties (client, événement…) ───
#if data.parties.len() > 0 {
  grid(
    columns: data.parties.map(_ => 1fr),
    gutter: 4mm,
    ..data.parties.map(party => block(fill: soft, inset: 3.5mm, radius: 2mm, width: 100%)[
      #label(party.title) \
      #for (index, line) in party.lines.enumerate() [
        #if index == 0 [*#rich(line)*] else [#rich(line)] \
      ]
    ]),
  )
  v(5mm)
}

// ─── Tableau principal (lignes de prestations, détail d'un paiement…) ───
#let th(body) = text(weight: "semibold", fill: white, size: 8.3pt, rich(body))
#let align-of(value) = if value == "end" { end } else if value == "center" { center } else { start }

#if data.at("table", default: none) != none {
  let t = data.table
  table(
    columns: t.columns.map(column => if column.width == "auto" { auto } else { 1fr }),
    align: t.columns.map(column => align-of(column.align) + top),
    stroke: (x, y) => if y == 0 { none } else { (bottom: 0.5pt + line-color) },
    fill: (x, y) => if y == 0 { brand } else { none },
    inset: (x: 2.5mm, y: 2.1mm),
    ..t.columns.map(column => th(column.label)),
    ..t.rows.flatten().map(cell => {
      if type(cell) == dictionary {
        [#text(weight: "semibold", rich(cell.main))#if cell.at("sub", default: none) != none [ \ #text(size: 7.8pt, fill: muted, rich(cell.sub))]]
      } else { rich(cell) }
    }),
  )
  v(3mm)
}

// ─── Récapitulatif TVA et totaux ───
#let totals-block = if data.at("totals", default: ()).len() > 0 {
  table(
    columns: (1fr, auto),
    align: (start, end),
    stroke: none,
    inset: (x: 0mm, y: 1.6mm),
    ..data.totals
      .map(row => {
        let strong = row.at("strong", default: false)
        let cells = (
          text(weight: if strong { "bold" } else { "regular" }, size: if strong { 11pt } else { 9.5pt }, rich(row.label)),
          text(
            weight: if strong { "bold" } else { "regular" },
            size: if strong { 11pt } else { 9.5pt },
            fill: if strong { brand } else { black },
            rich(row.value),
          ),
        )
        if strong { (table.hline(stroke: 0.8pt + brand), ..cells) } else { cells }
      })
      .flatten(),
  )
}

#let tax-block = if data.at("taxSummary", default: none) != none {
  let s = data.taxSummary
  [
    #label(s.title)
    #table(
      columns: (auto, 1fr, 1fr),
      align: (center, end, end),
      stroke: 0.5pt + line-color,
      inset: (x: 2.5mm, y: 1.7mm),
      ..s.columns.map(column => text(weight: "semibold", size: 8.3pt, rich(column))),
      ..s.rows.flatten().map(cell => rich(cell)),
    )
  ]
}

#if totals-block != none or tax-block != none {
  grid(columns: (1fr, 80mm), gutter: 6mm, if tax-block != none { tax-block } else { [] }, if totals-block != none { totals-block } else { [] })
}

// ─── Montant en lettres ───
#if data.at("amountInWords", default: none) != none {
  v(2mm)
  block(fill: soft, inset: 3mm, radius: 2mm, width: 100%)[#rich(data.amountInWords)]
}

// ─── Paragraphes (conditions, échéancier, mentions) ───
#for section in data.at("sections", default: ()) {
  v(3.5mm)
  text(weight: "semibold")[#rich(section.title)]
  linebreak()
  for item in section.items [
    #if section.at("bullets", default: true) [• ] #rich(item) \
  ]
}

// ─── Zone de signature ───
#if data.at("signature", default: none) != none {
  v(6mm)
  grid(
    columns: (1fr, 1fr),
    gutter: 8mm,
    [],
    block(stroke: 0.8pt + line-color, inset: 4mm, radius: 2mm, width: 100%, height: 30mm)[
      #text(weight: "semibold")[#rich(data.signature.title)] \
      #label(data.signature.hint)
      #if data.signature.at("signedBy", default: none) != none [
        #v(2mm)
        #rich(data.signature.signedBy)
      ]
    ],
  )
}
