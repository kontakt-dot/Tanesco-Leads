/**
 * Verträge: Bausteine, Vorlage, Platzhalter und die HTML-Ansicht – für den Builder (Vorschau), die öffentliche
 * Unterschriften-Seite (Kunde) und die unterschriebene Fassung mit Nachweis. Server und Chat-Build nutzen dieselbe Datei.
 */
import { COMPANY_FOOTER, COMPANY_WEBSITE, TANESCO_LOGO_PATH, newBlockId } from "./email-design";

export type ContractBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "bullets"; items: string[] }
  | { id: string; type: "image"; src: string; alt?: string; width?: number; align?: "left" | "center" | "right" } // src: eingebettetes Bild (data:) oder Adresse
  | { id: string; type: "logo"; src?: string | null; height?: number }
  | { id: string; type: "parties" } // Vertragsparteien aus den Werten (Anbieter + Kunde)
  | { id: string; type: "detail"; key: string; label: string; value: string; hint?: string } // Vertragsangabe – füllt der Anbieter im Builder aus (Liefergebiet, Menge, Preis …), im Text als {{key}}
  | { id: string; type: "field"; key: string; label: string; required?: boolean; placeholder?: string } // füllt der Kunde beim Unterschreiben aus (optional)
  | { id: string; type: "date"; label?: string; mode: "unterschrift" | "fest"; value?: string | null }
  | { id: string; type: "signature"; party: "kunde" | "anbieter"; label?: string; image?: string | null; signedName?: string | null; signedAt?: string | null } // Anbieter: eigene Unterschrift (Bild, Name, Zeitpunkt) direkt im Builder
  | { id: string; type: "divider" }
  | { id: string; type: "pagebreak" };
export type ContractBlockType = ContractBlock["type"];
export type ContractStatus = "entwurf" | "gesendet" | "angesehen" | "unterschrieben" | "abgelehnt" | "storniert";
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = { entwurf: "Entwurf", gesendet: "Gesendet", angesehen: "Angesehen", unterschrieben: "Unterschrieben", abgelehnt: "Abgelehnt", storniert: "Storniert" };
export type ContractEventKind = "erstellt" | "geaendert" | "gesendet" | "erinnert" | "angesehen" | "unterschrieben" | "abgelehnt" | "storniert";
export const CONTRACT_EVENT_LABEL: Record<ContractEventKind, string> = { erstellt: "Erstellt", geaendert: "Geändert", gesendet: "Zur Unterschrift gesendet", erinnert: "Erinnerung gesendet", angesehen: "Vom Kunden geöffnet", unterschrieben: "Elektronisch unterschrieben", abgelehnt: "Abgelehnt", storniert: "Storniert" };
/** Werte für Platzhalter: {{firma}}, {{name}}, {{email}}, {{strasse}}, {{plzOrt}}, {{anbieterFirma}}, {{anbieterAdresse}}, {{anbieterVertreter}}, {{datum}}, {{titel}} – plus die Vertragsangaben des Anbieters und die Felder des Kunden ({{key}}). */
export type ContractValues = Record<string, string>;
export type ContractSignature = { name: string; image: string | null; signedAt: Date | string; ip?: string | null; userAgent?: string | null; documentHash?: string | null; signedHash?: string | null };
export type ContractEventView = { kind: ContractEventKind; note?: string | null; ip?: string | null; createdAt: Date | string };
export type ContractDesign = { primaryColor?: string; logoUrl?: string | null; anbieterUnterschrift?: string | null /* eingebettetes Bild der eigenen Unterschrift */ };
export const DEFAULT_CONTRACT_DESIGN: Required<Pick<ContractDesign, "primaryColor">> & ContractDesign = { primaryColor: "#bc001d", logoUrl: TANESCO_LOGO_PATH, anbieterUnterschrift: null };

export const CONTRACT_BLOCK_TYPES: Array<{ type: ContractBlockType; label: string; hint: string }> = [
  { type: "heading", label: "Überschrift", hint: "Abschnittstitel, z. B. „§ 1 Vertragsgegenstand“" },
  { type: "text", label: "Text", hint: "Absätze mit Platzhaltern wie {{firma}} oder {{datum}}" },
  { type: "bullets", label: "Aufzählung", hint: "Punkte, z. B. Leistungen oder Pflichten" },
  { type: "parties", label: "Vertragsparteien", hint: "Anbieter und Kunde mit Anschrift – aus den Vertragsdaten" },
  { type: "detail", label: "Vertragsangabe", hint: "Angabe, die du selbst ausfüllst – z. B. Liefergebiet, Menge oder Preis; im Text als {{schlüssel}} nutzbar" },
  { type: "field", label: "Feld für den Kunden", hint: "Nur wenn der Kunde selbst etwas eintragen soll, z. B. seine USt-ID – beim Unterschreiben" },
  { type: "date", label: "Datum", hint: "Datum der Unterschrift (automatisch) oder ein festes Datum" },
  { type: "signature", label: "Unterschrift", hint: "Unterschriftsfeld für den Kunden oder den Anbieter" },
  { type: "logo", label: "Logo", hint: "Dein Logo oben im Vertrag" },
  { type: "image", label: "Bild", hint: "Ein Bild, z. B. Ablaufgrafik oder Stempel" },
  { type: "divider", label: "Trennlinie", hint: "Feine Linie zwischen Abschnitten" },
  { type: "pagebreak", label: "Seitenumbruch", hint: "Neue Seite im PDF und beim Drucken" },
];

export const newContractBlock = (type: ContractBlockType): ContractBlock => {
  const id = newBlockId();
  switch (type) {
    case "heading": return { id, type, text: "Neuer Abschnitt" };
    case "text": return { id, type, text: "Text des Abschnitts …" };
    case "bullets": return { id, type, items: ["Erster Punkt", "Zweiter Punkt"] };
    case "image": return { id, type, src: "", alt: "", width: 60, align: "center" };
    case "logo": return { id, type, src: null, height: 36 };
    case "parties": return { id, type };
    case "detail": return { id, type, key: `angabe_${id.slice(1)}`, label: "Angabe", value: "", hint: "" };
    case "field": return { id, type, key: `feld_${id.slice(1)}`, label: "USt-IdNr.", required: true, placeholder: "" };
    case "date": return { id, type, label: "Datum", mode: "unterschrift", value: null };
    case "signature": return { id, type, party: "kunde", label: "Unterschrift Kunde" };
    case "divider": return { id, type };
    case "pagebreak": return { id, type };
  }
};

export type ContractStarterKind = "leadliefervertrag" | "testphase" | "leer";
export const CONTRACT_STARTERS: Array<{ kind: ContractStarterKind; label: string; hint: string }> = [
  { kind: "leadliefervertrag", label: "Leadliefervertrag", hint: "Fertiger Rahmen: Leistungen, Liefergebiet, Menge, Preis je Lead, Reklamation, Laufzeit – du trägst die Eckdaten ein, der Kunde unterschreibt nur" },
  { kind: "testphase", label: "Testphase", hint: "Allgemeine Vereinbarung für eine Testphase: Leistung, Dauer, Umfang, Konditionen und was danach gilt" },
  { kind: "leer", label: "Leerer Vertrag", hint: "Logo, Vertragsparteien, ein Textabschnitt, Datum und Unterschriften – den Rest baust du selbst oder lässt ihn von der KI schreiben" },
];
const detail = (key: string, label: string, hint: string, value = ""): ContractBlock => ({ id: newBlockId(), type: "detail", key, label, value, hint });
/** Vorlagen – fertige Rahmen, die du im Builder anpasst. Der Kunde füllt nichts aus: alle Eckdaten sind Vertragsangaben des Anbieters. Kein Rechtsrat: Texte vor dem Einsatz prüfen (lassen). */
export function contractStarter(kind: ContractStarterKind = "leadliefervertrag"): { title: string; blocks: ContractBlock[] } {
  if (kind === "leer") return { title: "Neuer Vertrag", blocks: [{ id: newBlockId(), type: "logo", src: null, height: 36 }, { id: newBlockId(), type: "heading", text: "Vertrag" }, { id: newBlockId(), type: "parties" }, { id: newBlockId(), type: "text", text: "Text des Vertrags …" }, { id: newBlockId(), type: "date", label: "Datum", mode: "unterschrift", value: null }, { id: newBlockId(), type: "signature", party: "anbieter", label: "Unterschrift Anbieter" }, { id: newBlockId(), type: "signature", party: "kunde", label: "Unterschrift Kunde" }] };
  if (kind === "testphase") return { title: "Vereinbarung über eine Testphase", blocks: [
    { id: newBlockId(), type: "logo", src: null, height: 36 },
    { id: newBlockId(), type: "heading", text: "Vereinbarung über eine Testphase" },
    { id: newBlockId(), type: "parties" },
    { id: newBlockId(), type: "heading", text: "§ 1 Gegenstand" },
    { id: newBlockId(), type: "text", text: "Der Anbieter stellt dem Kunden die folgende Leistung für eine zeitlich begrenzte Testphase zur Verfügung: {{leistung}}.\n\nZiel der Testphase ist es, Qualität, Ablauf und Zusammenarbeit unverbindlich zu prüfen, bevor beide Seiten über eine dauerhafte Zusammenarbeit entscheiden." },
    detail("leistung", "Leistung", "z. B. Lieferung telefonisch qualifizierter Kundenanfragen (Leads) für Photovoltaik"),
    { id: newBlockId(), type: "heading", text: "§ 2 Dauer und Umfang der Testphase" },
    { id: newBlockId(), type: "text", text: "Die Testphase beginnt {{beginn}} und dauert {{dauer}}. Sie umfasst {{umfang}}.\n\nFür die Testphase gilt: {{konditionen}}." },
    detail("beginn", "Beginn", "z. B. mit Unterzeichnung oder am 01.12.2026", "mit Unterzeichnung dieser Vereinbarung"),
    detail("dauer", "Dauer", "z. B. 4 Wochen"),
    detail("umfang", "Umfang", "z. B. bis zu 20 Leads"),
    detail("konditionen", "Konditionen in der Testphase", "z. B. die ersten 10 Leads kostenlos, danach 49 € je Lead netto"),
    { id: newBlockId(), type: "heading", text: "§ 3 Nach der Testphase" },
    { id: newBlockId(), type: "text", text: "Die Testphase endet automatisch mit Ablauf der vereinbarten Dauer – eine Kündigung ist dafür nicht nötig. Nach der Testphase gilt: {{danach}}.\n\nOhne eine gesonderte Vereinbarung entstehen dem Kunden nach der Testphase keine weiteren Pflichten." },
    detail("danach", "Nach der Testphase", "z. B. Fortsetzung nur nach schriftlicher Bestätigung beider Seiten, dann 79 € je Lead netto, Kündigung jederzeit mit 14 Tagen zum Monatsende"),
    { id: newBlockId(), type: "heading", text: "§ 4 Mitwirkung des Kunden" },
    { id: newBlockId(), type: "bullets", items: ["Zeitnahe Bearbeitung der gelieferten Leistung – übergebene Interessenten werden innerhalb von 24 Stunden kontaktiert", "Rückmeldung zur Qualität innerhalb von 7 Tagen, damit der Anbieter nachsteuern kann", "Keine Weitergabe übergebener Daten an Dritte"] },
    { id: newBlockId(), type: "heading", text: "§ 5 Vergütung und Abrechnung" },
    { id: newBlockId(), type: "text", text: "Soweit in der Testphase Kosten anfallen, werden sie nach Lieferung abgerechnet; Vorkasse gibt es nicht. Alle Preise verstehen sich zuzüglich gesetzlicher Umsatzsteuer. Rechnungen sind innerhalb von 14 Tagen nach Zugang ohne Abzug zahlbar." },
    { id: newBlockId(), type: "heading", text: "§ 6 Datenschutz und Vertraulichkeit" },
    { id: newBlockId(), type: "text", text: "Die Parteien behandeln alle im Rahmen der Testphase ausgetauschten Informationen vertraulich und halten die datenschutzrechtlichen Vorgaben (insbesondere DSGVO) ein. Übergebene personenbezogene Daten werden ausschließlich für den vereinbarten Zweck verwendet." },
    { id: newBlockId(), type: "heading", text: "§ 7 Schlussbestimmungen" },
    { id: newBlockId(), type: "text", text: "Änderungen und Ergänzungen dieser Vereinbarung bedürfen der Textform. Sollte eine Bestimmung unwirksam sein, bleibt die Vereinbarung im Übrigen wirksam. Es gilt deutsches Recht.\n\nDiese Vereinbarung wird elektronisch geschlossen. Die elektronische Unterschrift des Kunden wird mit Zeitstempel, IP-Adresse und Prüfsumme des Dokuments protokolliert." },
    { id: newBlockId(), type: "date", label: "Datum", mode: "unterschrift", value: null },
    { id: newBlockId(), type: "signature", party: "anbieter", label: "Unterschrift Anbieter" },
    { id: newBlockId(), type: "signature", party: "kunde", label: "Unterschrift Kunde" },
  ] };
  return { title: "Leadliefervertrag", blocks: [
    { id: newBlockId(), type: "logo", src: null, height: 36 },
    { id: newBlockId(), type: "heading", text: "Vertrag über die Lieferung qualifizierter Kundenanfragen (Leads)" },
    { id: newBlockId(), type: "parties" },
    { id: newBlockId(), type: "heading", text: "§ 1 Vertragsgegenstand" },
    { id: newBlockId(), type: "text", text: "Der Anbieter liefert dem Kunden Kundenanfragen (Leads) von Interessenten für Photovoltaik- und/oder Wärmepumpenanlagen. Jeder Lead wird vor der Übergabe in der Regel anhand von zehn Fragen telefonisch vorqualifiziert und exklusiv an den Kunden übergeben. Die Übergabe erfolgt in Echtzeit per E-Mail, Schnittstelle oder über das vereinbarte System." },
    { id: newBlockId(), type: "heading", text: "§ 2 Leistungen des Anbieters" },
    { id: newBlockId(), type: "bullets", items: ["Eigene Leadgenerierung über Online-Kampagnen", "Telefonische Qualifizierung jedes Interessenten vor der Übergabe", "Exklusive Übergabe – kein Weiterverkauf desselben Leads an Dritte", "Interne Qualitätskontrolle und Reklamationsbearbeitung"] },
    { id: newBlockId(), type: "heading", text: "§ 3 Liefergebiet und Menge" },
    { id: newBlockId(), type: "text", text: "Für die Lieferung gelten folgende Eckdaten:" },
    detail("liefergebiet", "Liefergebiet", "z. B. Hessen oder PLZ 60–65"),
    detail("menge", "Menge pro Monat", "z. B. 30 Leads"),
    detail("leadart", "Leadart", "Photovoltaik, Wärmepumpe oder beides"),
    { id: newBlockId(), type: "heading", text: "§ 4 Vergütung und Abrechnung" },
    { id: newBlockId(), type: "text", text: "Der Preis je geliefertem Lead beträgt {{preis}} zuzüglich gesetzlicher Umsatzsteuer. Die Abrechnung erfolgt nach Lieferung, es besteht keine Vorkasse. Zum Kennenlernen gilt: {{kennenlernen}}.\n\nRechnungen sind innerhalb von 14 Tagen nach Zugang ohne Abzug zahlbar." },
    detail("preis", "Preis je Lead (netto)", "z. B. 79 €"),
    detail("kennenlernen", "Zum Kennenlernen", "z. B. die ersten 20 Leads kostenlos", "die ersten 20 Leads sind kostenlos"),
    { id: newBlockId(), type: "heading", text: "§ 5 Reklamation" },
    { id: newBlockId(), type: "text", text: "Leads mit falschen Kontaktdaten, ohne Erreichbarkeit nach drei dokumentierten Versuchen oder außerhalb des vereinbarten Liefergebiets können innerhalb von 7 Tagen nach Lieferung reklamiert werden. Anerkannte Reklamationen werden ersetzt oder gutgeschrieben." },
    { id: newBlockId(), type: "heading", text: "§ 6 Laufzeit und Kündigung" },
    { id: newBlockId(), type: "text", text: "Der Vertrag beginnt mit Unterzeichnung und läuft auf unbestimmte Zeit. Er kann von beiden Seiten jederzeit mit einer Frist von 14 Tagen zum Monatsende in Textform gekündigt werden. Eine Mindestabnahme besteht nicht." },
    { id: newBlockId(), type: "heading", text: "§ 7 Datenschutz" },
    { id: newBlockId(), type: "text", text: "Die Parteien verpflichten sich, die übergebenen personenbezogenen Daten der Interessenten ausschließlich zur Bearbeitung der Anfrage zu verwenden und die datenschutzrechtlichen Vorgaben (insbesondere DSGVO) einzuhalten. Der Kunde kontaktiert die Interessenten zeitnah nach Übergabe." },
    { id: newBlockId(), type: "heading", text: "§ 8 Schlussbestimmungen" },
    { id: newBlockId(), type: "text", text: "Änderungen und Ergänzungen dieses Vertrags bedürfen der Textform. Sollte eine Bestimmung unwirksam sein, bleibt der Vertrag im Übrigen wirksam. Es gilt deutsches Recht; Gerichtsstand ist, soweit zulässig, der Sitz des Anbieters.\n\nDieser Vertrag wird elektronisch geschlossen. Die elektronische Unterschrift des Kunden wird mit Zeitstempel, IP-Adresse und Prüfsumme des Dokuments protokolliert." },
    { id: newBlockId(), type: "date", label: "Datum", mode: "unterschrift", value: null },
    { id: newBlockId(), type: "signature", party: "anbieter", label: "Unterschrift Anbieter" },
    { id: newBlockId(), type: "signature", party: "kunde", label: "Unterschrift Kunde" },
  ] };
}

/** Standardwerte des Anbieters aus der Fußzeile („Firma · Straße · PLZ Ort“). */
export function providerValues(footer?: string | null, website?: string | null): ContractValues {
  const parts = (footer ?? COMPANY_FOOTER).split("·").map((part) => part.trim()).filter(Boolean);
  return { anbieterFirma: parts[0] ?? "Tanesco Digital GbR", anbieterAdresse: parts.slice(1).join(", "), anbieterWebseite: (website ?? COMPANY_WEBSITE).replace(/^https?:\/\//, ""), anbieterVertreter: "" };
}
export const CONTRACT_PLACEHOLDERS = ["{{firma}}", "{{name}}", "{{email}}", "{{strasse}}", "{{plzOrt}}", "{{anbieterFirma}}", "{{anbieterAdresse}}", "{{anbieterVertreter}}", "{{datum}}", "{{titel}}"];

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const formatContractDate = (value: Date | string | null | undefined) => value ? new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
export const formatContractStamp = (value: Date | string | null | undefined) => value ? `${new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" })} Uhr (Europe/Berlin)` : "";
/** Platzhalter füllen – unbekannte bleiben im Entwurf sichtbar, in der fertigen Fassung leer. */
export function fillContract(text: string, values: ContractValues, keepUnknown = false) {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => (values[key] !== undefined && values[key] !== "" ? values[key] : keepUnknown ? match : "…"));
}
/** Welche Felder der Kunde ausfüllen muss (für Prüfung beim Unterschreiben). */
export const contractFields = (blocks: ContractBlock[]) => blocks.filter((block): block is Extract<ContractBlock, { type: "field" }> => block.type === "field");
/** Vertragsangaben des Anbieters (Liefergebiet, Preis …) – ihre Werte füllen die Platzhalter {{key}} im Text. */
export const contractDetails = (blocks: ContractBlock[]) => blocks.filter((block): block is Extract<ContractBlock, { type: "detail" }> => block.type === "detail");
export const detailValues = (blocks: ContractBlock[]): ContractValues => Object.fromEntries(contractDetails(blocks).filter((block) => block.key && block.value.trim()).map((block) => [block.key, block.value.trim()]));
/** Welche Vertragsangaben noch leer sind (vor dem Senden ausfüllen). */
export const missingDetails = (blocks: ContractBlock[]) => contractDetails(blocks).filter((block) => !block.value.trim()).map((block) => block.label || block.key);
/** Unterschriftsfelder des Anbieters, die noch nicht unterschrieben sind. */
export const unsignedProviderBlocks = (blocks: ContractBlock[]) => blocks.filter((block) => block.type === "signature" && block.party === "anbieter" && !block.image);
/** Eigene Unterschrift entfernen (z. B. bei einer Kopie – dort wird neu unterschrieben). */
export const withoutProviderSignatures = (blocks: ContractBlock[]): ContractBlock[] => blocks.map((block) => block.type === "signature" && block.party === "anbieter" && block.image ? { ...block, image: null, signedName: null, signedAt: null } : block);
export const contractNeedsSignature = (blocks: ContractBlock[]) => blocks.some((block) => block.type === "signature" && block.party === "kunde");
/** Kurze Zusammenfassung für Listen: Anzahl Abschnitte, eigene Angaben, Felder für den Kunden, ob eine Kundenunterschrift drin ist. */
export const contractOutline = (blocks: ContractBlock[]) => ({ sections: blocks.filter((block) => block.type === "heading").length, details: contractDetails(blocks).length, fields: contractFields(blocks).length, signature: contractNeedsSignature(blocks) });

export type ContractRenderOptions = {
  mode: "entwurf" | "unterschreiben" | "unterschrieben" | "abgelehnt" | "storniert";
  values: ContractValues;
  fieldValues?: Record<string, string> | null;
  signature?: ContractSignature | null;
  events?: ContractEventView[] | null;
  design?: ContractDesign | null;
  logoBase?: string | null; // Basis-Adresse für das Standard-Logo (/brand/…)
  token?: string | null; apiBase?: string | null; // Unterschreiben: wohin die Unterschrift geschickt wird
  signerName?: string | null; pdfUrl?: string | null; embedded?: boolean; // embedded: in der App eingebettet (Nachricht statt Neuladen)
};

const SIGN_SCRIPT = `
(function(){
  var root=document.getElementById('sign');if(!root)return;var token=root.getAttribute('data-token');var api=root.getAttribute('data-api')||'';var embedded=root.getAttribute('data-embedded')==='1';
  var canvas=document.getElementById('pad');var ctx=canvas.getContext('2d');var drawing=false,last=null,dirty=false;var ratio=window.devicePixelRatio||1;
  function size(){var r=canvas.getBoundingClientRect();canvas.width=r.width*ratio;canvas.height=r.height*ratio;ctx.scale(ratio,ratio);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#101828';}
  size();window.addEventListener('resize',function(){var img=canvas.toDataURL();size();var i=new Image();i.onload=function(){ctx.drawImage(i,0,0,canvas.getBoundingClientRect().width,canvas.getBoundingClientRect().height)};i.src=img;});
  function pos(e){var r=canvas.getBoundingClientRect();var t=e.touches?e.touches[0]:e;return {x:t.clientX-r.left,y:t.clientY-r.top};}
  function start(e){drawing=true;last=pos(e);e.preventDefault();}function move(e){if(!drawing)return;var p=pos(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;dirty=true;e.preventDefault();}function end(){drawing=false;}
  canvas.addEventListener('mousedown',start);canvas.addEventListener('mousemove',move);window.addEventListener('mouseup',end);canvas.addEventListener('touchstart',start,{passive:false});canvas.addEventListener('touchmove',move,{passive:false});canvas.addEventListener('touchend',end);
  var mode='zeichnen';document.querySelectorAll('[data-sign-tab]').forEach(function(b){b.addEventListener('click',function(){mode=b.getAttribute('data-sign-tab');document.querySelectorAll('[data-sign-tab]').forEach(function(x){x.classList.toggle('on',x===b)});document.getElementById('pad-wrap').style.display=mode==='zeichnen'?'block':'none';document.getElementById('type-wrap').style.display=mode==='tippen'?'block':'none';});});
  document.getElementById('clear').addEventListener('click',function(){ctx.clearRect(0,0,canvas.width,canvas.height);dirty=false;});
  var typed=document.getElementById('typed');var typedPreview=document.getElementById('typed-preview');if(typed){typed.addEventListener('input',function(){typedPreview.textContent=typed.value||' ';});}
  function typedImage(){var c=document.createElement('canvas');c.width=900;c.height=240;var x=c.getContext('2d');x.fillStyle='#101828';x.font='italic 400 92px "Brush Script MT","Segoe Script","Snell Roundhand",cursive';x.textBaseline='middle';x.fillText(typed.value,30,130);return c.toDataURL('image/png');}
  function msg(text,ok){var m=document.getElementById('sign-msg');m.textContent=text;m.className='sign-msg '+(ok?'ok':'err');m.style.display='block';}
  document.getElementById('submit').addEventListener('click',function(){
    var name=(document.getElementById('signer').value||'').trim();if(name.length<3){msg('Bitte den vollständigen Namen eintragen.',false);return;}
    var fields={};var missing=[];document.querySelectorAll('[data-field]').forEach(function(i){var v=i.value.trim();fields[i.getAttribute('data-field')]=v;if(i.hasAttribute('required')&&!v)missing.push(i.getAttribute('data-label'));});
    if(missing.length){msg('Bitte ausfüllen: '+missing.join(', '),false);return;}
    if(!document.getElementById('consent').checked){msg('Bitte bestätige, dass du den Vertrag gelesen hast und elektronisch unterschreibst.',false);return;}
    var image=null;if(mode==='zeichnen'){if(!dirty){msg('Bitte im Feld unterschreiben (mit Maus oder Finger) – oder auf „Tippen“ wechseln.',false);return;}image=canvas.toDataURL('image/png');}else{if((typed.value||'').trim().length<3){msg('Bitte den Namen als Unterschrift eintippen.',false);return;}image=typedImage();}
    var payload={signerName:name,fields:fields,signatureImage:image,method:mode,consent:true};
    var btn=document.getElementById('submit');btn.disabled=true;btn.textContent='Wird gespeichert …';
    if(embedded&&window.parent&&window.parent!==window){window.parent.postMessage({type:'tanesco:vertrag-unterschrieben',token:token,payload:payload},'*');msg('Unterschrift übermittelt.',true);return;}
    fetch(api+'/api/vertrag/'+token+'/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(x){if(!x.ok){throw new Error(x.j&&x.j.error||'Fehler')}window.location.reload();}).catch(function(e){btn.disabled=false;btn.textContent='Jetzt unterschreiben';msg(e.message||'Das hat nicht geklappt – bitte noch einmal versuchen.',false);});
  });
  var decline=document.getElementById('decline');if(decline){decline.addEventListener('click',function(){var reason=window.prompt('Möchtest du den Vertrag ablehnen? Du kannst einen Grund angeben (optional):');if(reason===null)return;if(embedded&&window.parent&&window.parent!==window){window.parent.postMessage({type:'tanesco:vertrag-abgelehnt',token:token,reason:reason},'*');return;}fetch(api+'/api/vertrag/'+token+'/decline',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason:reason})}).then(function(){window.location.reload();});});}
})();`;

/** Die komplette Seite: Vertrag als weißes Blatt, darunter (je nach Modus) das Unterschriftsfeld oder der Nachweis. */
export function renderContractHtml(contract: { title: string; blocks: ContractBlock[] }, options: ContractRenderOptions): string {
  const design = { ...DEFAULT_CONTRACT_DESIGN, ...(options.design ?? {}) }; const accent = design.primaryColor || "#bc001d";
  const signedAt = options.signature?.signedAt ?? null;
  const values: ContractValues = { ...detailValues(contract.blocks), ...options.values, ...(options.fieldValues ?? {}), titel: contract.title, datum: options.values.datum || (signedAt ? formatContractDate(signedAt) : options.mode === "unterschreiben" ? formatContractDate(new Date()) : "") };
  const keepUnknown = options.mode === "entwurf";
  const fill = (text: string) => esc(fillContract(text, values, keepUnknown)).replace(/\n/g, "<br>");
  const logoSrc = (src?: string | null) => { const value = (src ?? design.logoUrl ?? TANESCO_LOGO_PATH) || ""; return value.startsWith("/") ? `${(options.logoBase ?? "").replace(/\/+$/, "")}${value}` : value; };
  const party = (lines: string[]) => lines.filter(Boolean).map((line) => `<div>${esc(line)}</div>`).join("");
  const fieldValue = (key: string) => options.fieldValues?.[key] ?? "";
  const canEdit = options.mode === "unterschreiben";
  const body = contract.blocks.map((block) => {
    switch (block.type) {
      case "heading": return `<h2 class="c-h">${fill(block.text)}</h2>`;
      case "text": return `<div class="c-p">${fillContract(block.text, values, keepUnknown).split(/\n{2,}/).map((part) => `<p>${esc(part).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
      case "bullets": return `<ul class="c-ul">${block.items.map((item) => `<li>${fill(item)}</li>`).join("")}</ul>`;
      case "image": return block.src ? `<div class="c-img" style="text-align:${block.align ?? "center"}"><img src="${esc(block.src)}" alt="${esc(block.alt ?? "")}" style="width:${Math.min(100, Math.max(10, block.width ?? 60))}%"></div>` : (options.mode === "entwurf" ? `<div class="c-img c-empty">Bild wählen …</div>` : "");
      case "logo": return `<div class="c-logo"><img src="${esc(logoSrc(block.src))}" alt="Logo" style="height:${Math.min(120, Math.max(16, block.height ?? 36))}px"></div>`;
      case "parties": return `<div class="c-parties"><div><span class="c-label">Anbieter</span>${party([values.anbieterFirma, values.anbieterAdresse, values.anbieterVertreter ? `vertreten durch ${values.anbieterVertreter}` : "", values.anbieterWebseite ?? ""])}</div><div><span class="c-label">Kunde</span>${party([values.firma || (keepUnknown ? "{{firma}}" : ""), values.name, values.strasse, values.plzOrt, values.email])}</div></div>`;
      case "detail": return `<div class="c-kv"><span>${esc(block.label)}</span><strong>${block.value.trim() ? esc(block.value.trim()).replace(/\n/g, "<br>") : options.mode === "entwurf" ? `<i class="c-dots">noch eintragen</i>` : "–"}</strong></div>`;
      case "field": return canEdit
        ? `<label class="c-field"><span>${esc(block.label)}${block.required ? " *" : ""}</span><input data-field="${esc(block.key)}" data-label="${esc(block.label)}" ${block.required ? "required" : ""} placeholder="${esc(block.placeholder ?? "")}" value="${esc(fieldValue(block.key))}"></label>`
        : `<div class="c-field is-static"><span>${esc(block.label)}</span><strong>${esc(fieldValue(block.key)) || (options.mode === "entwurf" ? `<i class="c-dots">füllt der Kunde aus</i>` : "–")}</strong></div>`;
      case "date": return `<div class="c-date"><span>${esc(block.label ?? "Datum")}</span><strong>${block.mode === "fest" ? esc(formatContractDate(block.value)) || "–" : (signedAt ? formatContractDate(signedAt) : canEdit ? formatContractDate(new Date()) : `<i class="c-dots">Datum der Unterschrift</i>`)}</strong></div>`;
      case "signature": {
        if (block.party === "anbieter") { const image = block.image || design.anbieterUnterschrift; const who = block.signedName || values.anbieterVertreter; return `<div class="c-sig"><div class="c-sig-box${image ? " is-signed" : options.mode === "entwurf" ? " is-todo" : ""}">${image ? `<img src="${esc(image)}" alt="Unterschrift Anbieter">` : options.mode === "entwurf" ? "Noch nicht unterschrieben" : ""}</div><div class="c-sig-line">${esc(block.label ?? "Unterschrift Anbieter")}${who ? ` · ${esc(who)}` : ""}${values.anbieterFirma ? `, ${esc(values.anbieterFirma)}` : ""}${block.signedAt ? ` · ${formatContractDate(block.signedAt)}` : ""}</div></div>`; }
        if (options.signature) return `<div class="c-sig"><div class="c-sig-box is-signed">${options.signature.image ? `<img src="${esc(options.signature.image)}" alt="Unterschrift">` : ""}</div><div class="c-sig-line">${esc(block.label ?? "Unterschrift Kunde")} · ${esc(options.signature.name)} · ${formatContractStamp(options.signature.signedAt)}</div></div>`;
        if (canEdit) return `<div class="c-sig"><div class="c-sig-box is-here">Unterschrift unten im Feld „Jetzt unterschreiben“</div><div class="c-sig-line">${esc(block.label ?? "Unterschrift Kunde")}</div></div>`;
        return `<div class="c-sig"><div class="c-sig-box"></div><div class="c-sig-line">${esc(block.label ?? "Unterschrift Kunde")}</div></div>`;
      }
      case "divider": return `<hr class="c-hr">`;
      case "pagebreak": return `<div class="c-break"></div>`;
    }
  }).join("");
  const signPanel = canEdit ? `<section id="sign" class="sign" data-token="${esc(options.token ?? "")}" data-api="${esc(options.apiBase ?? "")}" data-embedded="${options.embedded ? "1" : "0"}">
    <h3>Jetzt unterschreiben</h3>
    <p class="sign-hint">Bitte Felder prüfen, Namen eintragen und im Feld unterschreiben – mit Maus, Finger oder getippt. Die Unterschrift wird mit Datum, Uhrzeit und IP-Adresse protokolliert.</p>
    <label class="sign-name"><span>Vollständiger Name</span><input id="signer" value="${esc(options.signerName ?? values.name ?? "")}" placeholder="Vor- und Nachname"></label>
    <div class="sign-tabs"><button type="button" class="on" data-sign-tab="zeichnen">Zeichnen</button><button type="button" data-sign-tab="tippen">Tippen</button></div>
    <div id="pad-wrap" class="pad-wrap"><canvas id="pad"></canvas><button type="button" id="clear" class="pad-clear">Löschen</button></div>
    <div id="type-wrap" class="type-wrap" style="display:none"><input id="typed" placeholder="Namen als Unterschrift tippen"><div id="typed-preview" class="typed-preview"> </div></div>
    <label class="sign-consent"><input type="checkbox" id="consent"> Ich habe den Vertrag gelesen, bin mit dem Inhalt einverstanden und unterschreibe ihn elektronisch.</label>
    <div id="sign-msg" class="sign-msg" style="display:none"></div>
    <div class="sign-actions"><button type="button" id="submit" class="sign-submit">Jetzt unterschreiben</button><button type="button" id="decline" class="sign-decline">Ablehnen</button></div>
  </section>` : "";
  const proof = options.signature && options.mode === "unterschrieben" ? `<section class="proof"><h3>Nachweis der elektronischen Unterschrift</h3><dl>
    <dt>Unterschrieben von</dt><dd>${esc(options.signature.name)}</dd>
    <dt>Zeitpunkt</dt><dd>${formatContractStamp(options.signature.signedAt)}</dd>
    ${options.signature.ip ? `<dt>IP-Adresse</dt><dd>${esc(options.signature.ip)}</dd>` : ""}
    ${options.signature.userAgent ? `<dt>Gerät / Browser</dt><dd>${esc(options.signature.userAgent.slice(0, 160))}</dd>` : ""}
    ${options.signature.documentHash ? `<dt>Prüfsumme Dokument (SHA-256)</dt><dd class="mono">${esc(options.signature.documentHash)}</dd>` : ""}
    ${options.signature.signedHash ? `<dt>Prüfsumme Unterschrift (SHA-256)</dt><dd class="mono">${esc(options.signature.signedHash)}</dd>` : ""}
  </dl>${options.events?.length ? `<ol class="proof-log">${options.events.map((event) => `<li><span>${formatContractStamp(event.createdAt)}</span> ${esc(CONTRACT_EVENT_LABEL[event.kind] ?? event.kind)}${event.note ? ` – ${esc(event.note)}` : ""}${event.ip ? ` <i>(${esc(event.ip)})</i>` : ""}</li>`).join("")}</ol>` : ""}${options.pdfUrl ? `<p class="proof-actions"><a class="btn" href="${esc(options.pdfUrl)}">PDF herunterladen</a> <button type="button" class="btn ghost" onclick="window.print()">Drucken</button></p>` : `<p class="proof-actions"><button type="button" class="btn ghost" onclick="window.print()">Drucken / als PDF sichern</button></p>`}</section>` : "";
  const notice = options.mode === "abgelehnt" ? `<section class="proof is-warn"><h3>Dieser Vertrag wurde abgelehnt.</h3><p>Bei Fragen antworte einfach auf die E-Mail, mit der du den Vertrag bekommen hast.</p></section>` : options.mode === "storniert" ? `<section class="proof is-warn"><h3>Dieser Vertrag wurde zurückgezogen.</h3><p>Der Anbieter hat den Vertrag storniert – er kann nicht mehr unterschrieben werden.</p></section>` : "";
  const badge = options.mode === "unterschrieben" ? `<div class="topbar is-ok">Elektronisch unterschrieben am ${formatContractDate(signedAt)}</div>` : options.mode === "unterschreiben" ? `<div class="topbar">Bitte prüfen und unten unterschreiben</div>` : "";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(contract.title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"><style>
  :root{--accent:${accent};--ink:#101828;--muted:#667085;--line:#e4e7ec}
  *{box-sizing:border-box}body{margin:0;background:#f2f4f7;font-family:"DM Sans",Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:820px;margin:0 auto;padding:22px 14px 60px}
  .topbar{display:inline-flex;align-items:center;gap:8px;margin:0 0 12px;padding:7px 12px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:13px;font-weight:600;color:var(--muted)}.topbar.is-ok{color:#067647;border-color:#abefc6;background:#ecfdf3}
  .sheet{background:#fff;border:1px solid var(--line);border-radius:18px;padding:48px 56px;box-shadow:0 12px 40px -24px rgba(16,24,40,.25)}
  .c-logo{margin:0 0 22px}.c-logo img{display:block;max-width:240px;object-fit:contain}
  .c-h{font-size:20px;line-height:1.3;margin:26px 0 10px;font-weight:700;letter-spacing:-.01em}.c-h:first-child{margin-top:0}.sheet>.c-logo+.c-h{font-size:24px}
  .c-p p{margin:0 0 10px}.c-ul{margin:4px 0 12px;padding-left:22px}.c-ul li{margin:3px 0}
  .c-img{margin:14px 0}.c-img img{max-width:100%;border-radius:8px}.c-empty{padding:28px;border:1px dashed var(--line);border-radius:10px;color:var(--muted);text-align:center;font-size:13px}
  .c-parties{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:8px 0 18px;padding:16px 18px;border:1px solid var(--line);border-radius:12px;background:#fafafb;font-size:14px}.c-label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:4px}
  .c-field{display:grid;gap:4px;margin:10px 0}.c-field>span{font-size:12.5px;font-weight:600;color:var(--muted)}.c-field input{height:42px;border:1.5px solid var(--line);border-radius:10px;padding:0 12px;font:inherit;font-size:15px;color:var(--ink);background:#fff;outline:none}.c-field input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(188,0,29,.12)}.c-field.is-static strong{font-weight:600;padding:8px 0;border-bottom:1px solid var(--line)}.c-dots{color:var(--muted);font-weight:400}
  .c-kv{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:6px 16px;padding:9px 12px;border:1px solid var(--line);border-top:0;font-size:14px;background:#fafafb}.c-kv span{color:var(--muted)}.c-kv strong{font-weight:600}.c-kv:first-child,:not(.c-kv)+.c-kv{border-top:1px solid var(--line);border-radius:10px 10px 0 0;margin-top:6px}.c-kv:last-child,.c-kv:not(:has(+.c-kv)){border-radius:0 0 10px 10px;margin-bottom:12px}.c-kv:first-child:last-child,:not(.c-kv)+.c-kv:not(:has(+.c-kv)){border-radius:10px}
  .c-date{display:flex;gap:10px;align-items:baseline;margin:16px 0 6px;font-size:14px}.c-date span{color:var(--muted)}.c-date strong{font-weight:600}
  .c-sig{margin:26px 0 8px;max-width:360px}.c-sig-box{height:92px;border-bottom:1.5px solid var(--ink);display:flex;align-items:flex-end;padding:0 4px 6px}.c-sig-box img{max-height:84px;max-width:100%}.c-sig-box.is-todo{align-items:center;justify-content:center;border:1.5px dashed #cfd4dc;border-radius:10px;color:var(--muted);font-size:13px;font-weight:600}.c-sig-box.is-here{align-items:center;justify-content:center;border:1.5px dashed var(--accent);border-radius:10px;color:var(--accent);font-size:13px;font-weight:600;background:rgba(188,0,29,.04)}.c-sig-line{margin-top:6px;font-size:12.5px;color:var(--muted)}
  .c-hr{border:0;border-top:1px solid var(--line);margin:22px 0}.c-break{height:0;page-break-after:always;break-after:page}
  .sign{margin-top:18px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:26px 28px;box-shadow:0 12px 40px -24px rgba(16,24,40,.25)}.sign h3{margin:0 0 6px;font-size:18px}.sign-hint{margin:0 0 14px;color:var(--muted);font-size:13.5px}
  .sign-name{display:grid;gap:4px;margin-bottom:12px}.sign-name span{font-size:12.5px;font-weight:600;color:var(--muted)}.sign-name input{height:44px;border:1.5px solid var(--line);border-radius:10px;padding:0 12px;font:inherit;font-size:15px}.sign-name input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(188,0,29,.12)}
  .sign-tabs{display:inline-flex;gap:4px;padding:3px;border-radius:10px;background:#f2f4f7;margin-bottom:10px}.sign-tabs button{border:0;background:transparent;padding:7px 14px;border-radius:8px;font:inherit;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer}.sign-tabs button.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(16,24,40,.08)}
  .pad-wrap{position:relative}#pad{display:block;width:100%;height:190px;border:1.5px dashed #cfd4dc;border-radius:12px;background:#fff;touch-action:none;cursor:crosshair}.pad-clear{position:absolute;right:10px;top:10px;border:1px solid var(--line);background:#fff;border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}
  .type-wrap input{width:100%;height:44px;border:1.5px solid var(--line);border-radius:10px;padding:0 12px;font:inherit;font-size:15px}.typed-preview{margin-top:10px;min-height:70px;padding:10px 14px;border:1.5px dashed #cfd4dc;border-radius:12px;font-family:"Brush Script MT","Segoe Script","Snell Roundhand",cursive;font-size:38px;font-style:italic}
  .sign-consent{display:flex;gap:10px;align-items:flex-start;margin:16px 0 12px;font-size:13.5px}.sign-consent input{margin-top:3px;width:17px;height:17px;accent-color:var(--accent)}
  .sign-msg{margin:0 0 12px;padding:10px 12px;border-radius:10px;font-size:13.5px}.sign-msg.err{background:#fef3f2;color:#b42318;border:1px solid #fecdca}.sign-msg.ok{background:#ecfdf3;color:#067647;border:1px solid #abefc6}
  .sign-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.sign-submit{border:0;border-radius:12px;padding:0 22px;height:46px;background:linear-gradient(90deg,#bc001d,#fb2c36);color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(220,38,38,.28)}.sign-submit:disabled{opacity:.6;cursor:default}.sign-decline{border:0;background:transparent;color:var(--muted);font:inherit;font-size:13px;cursor:pointer;text-decoration:underline}
  .proof{margin-top:18px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px 26px}.proof h3{margin:0 0 10px;font-size:16px}.proof dl{display:grid;grid-template-columns:200px 1fr;gap:6px 14px;margin:0;font-size:13.5px}.proof dt{color:var(--muted)}.proof dd{margin:0;word-break:break-all}.proof .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .proof-log{margin:14px 0 0;padding-left:18px;font-size:13px;color:var(--muted)}.proof-log span{color:var(--ink);font-weight:600;margin-right:6px}.proof.is-warn{border-color:#fedf89;background:#fffaeb}.proof.is-warn p{margin:0;color:#7a4b00}
  .proof-actions{margin:16px 0 0;display:flex;gap:10px}.btn{display:inline-flex;align-items:center;height:40px;padding:0 16px;border-radius:10px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;font-size:14px;border:0;cursor:pointer;font-family:inherit}.btn.ghost{background:#fff;color:var(--ink);border:1px solid var(--line)}
  @media (max-width:640px){.sheet{padding:26px 18px;border-radius:14px}.c-parties{grid-template-columns:1fr}.proof dl{grid-template-columns:1fr}.sign{padding:18px}}
  @media print{body{background:#fff}.wrap{padding:0;max-width:none}.sheet{border:0;box-shadow:none;padding:0}.topbar,.sign,.proof-actions{display:none}.proof{break-inside:avoid;border:1px solid #ccc}}
  </style></head><body><div class="wrap">${badge}<article class="sheet">${body}</article>${signPanel}${proof}${notice}</div>${canEdit ? `<script>${SIGN_SCRIPT}</script>` : ""}</body></html>`;
}

/* ---------------- KI: Vertrag aus einer Beschreibung ---------------- */
export type AiContractSection = { type: "heading" | "text" | "bullets" | "detail"; text?: string; items?: string[]; key?: string; label?: string; value?: string };
export type AiContractDraft = { title: string; sections: AiContractSection[] };
export const CONTRACT_AI_SCHEMA = { name: "vertrag", strict: false, schema: { type: "object", properties: {
  title: { type: "string", description: "Titel des Vertrags, z. B. „Vereinbarung über eine Testphase“" },
  sections: { type: "array", description: "Inhalt in Reihenfolge – Überschriften (§ 1 …), Absätze, Aufzählungen und Vertragsangaben", items: { type: "object", properties: {
    type: { type: "string", enum: ["heading", "text", "bullets", "detail"] },
    text: { type: "string", description: "heading: Überschrift; text: Absätze (Leerzeile trennt Absätze)" },
    items: { type: "array", items: { type: "string" }, description: "bullets: die Punkte" },
    key: { type: "string", description: "detail: Schlüssel in Kleinbuchstaben, z. B. preis – im Text als {{preis}} nutzbar" },
    label: { type: "string", description: "detail: Bezeichnung, z. B. „Preis je Lead (netto)“" },
    value: { type: "string", description: "detail: der Wert aus der Beschreibung, sonst leer" },
  }, required: ["type"] } },
}, required: ["title", "sections"] } };
export const CONTRACT_AI_SYSTEM = `Du schreibst deutsche Geschäftsverträge (B2B) für den Anbieter. Du bekommst eine Beschreibung in Alltagssprache und machst daraus einen sauberen, vollständigen Vertrag.
Regeln:
- Gliedere in Paragrafen als Überschriften („§ 1 Vertragsgegenstand“, „§ 2 …“). Übliche Punkte: Gegenstand, Leistungen, Umfang/Dauer, Vergütung und Abrechnung, Laufzeit und Kündigung, Haftung/Reklamation wenn passend, Datenschutz und Vertraulichkeit, Schlussbestimmungen.
- Klare, verständliche Sprache, keine erfundenen Gesetzesparagrafen, keine Platzhalter wie [XY].
- Konkrete Eckdaten (Preise, Mengen, Dauer, Gebiet, Termine …) als Vertragsangaben (type "detail") mit Schlüssel, Bezeichnung und dem Wert aus der Beschreibung. Im Fließtext kannst du sie als {{schlüssel}} einsetzen. Fehlt ein Wert, lass value leer.
- Der Kunde füllt nichts aus – er unterschreibt nur. Keine Felder für den Kunden.
- Vertragsparteien, Logo, Datum und Unterschriften ergänzt die Software selbst – schreibe sie nicht.
- Letzter Absatz der Schlussbestimmungen: „Dieser Vertrag wird elektronisch geschlossen. Die elektronische Unterschrift des Kunden wird mit Zeitstempel, IP-Adresse und Prüfsumme des Dokuments protokolliert.“
- Sprich den Kunden als „der Kunde“ und den Anbieter als „der Anbieter“ an.`;
const slugKey = (value: string) => value.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
/** KI-Antwort → Bausteine: Logo, Titel, Vertragsparteien, Inhalt, Datum und beide Unterschriften. */
export function aiDraftToContract(draft: Partial<AiContractDraft> | null | undefined): { title: string; blocks: ContractBlock[] } {
  const title = String(draft?.title ?? "").trim().slice(0, 200) || "Vertrag";
  const used = new Set<string>(); const body: ContractBlock[] = [];
  for (const section of Array.isArray(draft?.sections) ? draft!.sections : []) {
    if (!section || typeof section !== "object") continue;
    if (section.type === "heading" && section.text?.trim()) body.push({ id: newBlockId(), type: "heading", text: section.text.trim().slice(0, 300) });
    else if (section.type === "text" && section.text?.trim()) body.push({ id: newBlockId(), type: "text", text: section.text.trim().slice(0, 6000) });
    else if (section.type === "bullets" && Array.isArray(section.items)) { const items = section.items.map((item) => String(item).trim()).filter(Boolean).slice(0, 30); if (items.length) body.push({ id: newBlockId(), type: "bullets", items }); }
    else if (section.type === "detail" && (section.label || section.key)) { let key = slugKey(section.key || section.label || "") || `angabe_${body.length}`; while (used.has(key)) key = `${key}_2`; used.add(key); body.push({ id: newBlockId(), type: "detail", key, label: String(section.label || section.key).trim().slice(0, 120), value: String(section.value ?? "").trim().slice(0, 500), hint: "" }); }
  }
  if (!body.length) throw new Error("Die KI hat keinen Vertragstext geliefert – bitte die Beschreibung etwas genauer fassen.");
  return { title, blocks: [{ id: newBlockId(), type: "logo", src: null, height: 36 }, { id: newBlockId(), type: "heading", text: title }, { id: newBlockId(), type: "parties" }, ...body, { id: newBlockId(), type: "date", label: "Datum", mode: "unterschrift", value: null }, { id: newBlockId(), type: "signature", party: "anbieter", label: "Unterschrift Anbieter" }, { id: newBlockId(), type: "signature", party: "kunde", label: "Unterschrift Kunde" }] };
}
/** Ohne KI-Anbindung: passende Vorlage nach Stichworten (Testphase oder Leadlieferung), sonst leerer Rahmen mit der Beschreibung als Text. */
export function fallbackContractFromPrompt(prompt: string): { title: string; blocks: ContractBlock[] } {
  const text = prompt.toLowerCase();
  if (/test|probe|pilot/.test(text)) return contractStarter("testphase");
  if (/lead|anfrage/.test(text)) return contractStarter("leadliefervertrag");
  return aiDraftToContract({ title: "Vertrag", sections: [{ type: "heading", text: "§ 1 Vertragsgegenstand" }, { type: "text", text: prompt.trim() }, { type: "heading", text: "§ 2 Schlussbestimmungen" }, { type: "text", text: "Änderungen und Ergänzungen dieses Vertrags bedürfen der Textform. Es gilt deutsches Recht.\n\nDieser Vertrag wird elektronisch geschlossen. Die elektronische Unterschrift des Kunden wird mit Zeitstempel, IP-Adresse und Prüfsumme des Dokuments protokolliert." }] });
}
