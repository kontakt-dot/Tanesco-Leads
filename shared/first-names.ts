/**
 * Anrede aus dem Vornamen (v385): Wattfox verlangt bei Photovoltaik „Herr“ oder „Frau“. Fällt die Anrede im Gespräch nicht
 * („Herr/Frau <Nachname>“), schließt die Software sie aus dem Vornamen – zuerst über diese Liste, sonst fragt der Server die KI.
 * Nur eindeutige Vornamen stehen hier. Namen, die es für beide gibt (Andrea, Kim, Deniz …), stehen in AMBIGUOUS und bleiben offen.
 */
const MALE = `
adam adrian ahmad ahmed ahmet alexander alex alexej alessandro ali alfred alois andreas andrej andrzej anton antonio armin arne arnold arthur artur axel
bastian benedikt benjamin bernd bernhard björn bogdan boris bruno burak can carl carsten cem christian christoph christopher claus clemens cornelius
daniel darius david dennis detlef dieter dietmar dirk dominik dragan egon elias emil emre enrico erik erich ernst erwin eugen fabian felix ferdinand
florian frank franz friedrich fritz gabriel georg gerald gerd gerhard giovanni giuseppe goran gregor günter günther gustav hakan halil hans harald
hartmut hasan heiko hein heinrich heinz helmut hendrik henrik herbert hermann holger horst hubert hüseyin ibrahim igor ingo ivan jakob jan janusz
jens-uwe joachim jochen johann johannes jonas jonathan josef joseph jörg jürgen julian kai karl karsten kemal kerem klaus konrad konstantin kurt
lars leon leonhard lothar luca lucas ludwig lukas manfred marcel marco marcus mario mark markus martin mathias matthias max maximilian mehmet michael
milan mirko moritz murat mustafa niklas nico nils norbert olaf oliver oskar otto patrick paul peter philipp piotr rainer ralf ralph reinhard reinhold
rene richard robert roland rolf roman rudolf rüdiger sami samuel sascha-alexander sebastian selim serkan sergej siegfried simon stefan steffen stephan
sven theo thomas thorsten tim timo tobias tom torsten udo ulrich uwe valentin viktor vincent volker walter werner wilhelm willi wolfgang yusuf
zoran tomasz krzysztof pawel marek mariusz dariusz grzegorz wojciech jaroslaw zbigniew stanislaw sergio francesco lorenzo matteo roberto stefano
dimitri dimitrios georgios nikolaos konstantinos yannick yasin yunus ömer orhan osman ozan recep ramazan salih sinan süleyman tarik tolga ufuk volkan
yilmaz mahmut mehdi mohammed mohammad muhammed omar rashid said tarek walid youssef zeki fatih furkan gökhan kaan mert onur oguz serdar taner
francisco jose juan carlos pedro miguel luis manuel rafael jesus fernando joao paulo
`;
const FEMALE = `
agnes alexandra alina amelie andrea-maria angela angelika anita anja anke anna anne annette antje astrid ayse aylin barbara beate bettina bianca
birgit brigitte carina carmen carola caroline charlotte christa christel christiane christina christine claudia cornelia dagmar daniela diana doris
dorothea edith elena elfriede elisabeth elke ella emilia emine emma erika esra eva fatma franziska frieda gabriele gerda gertrud gisela gudrun hanna
hannah heidi heike helene helga hildegard ilse ina ines inge ingeborg ingrid irene iris irmgard jana janina jasmin jennifer jessica johanna josefine
julia juliane jutta karin katharina kathrin katja katrin kerstin klara kristina laura lea lena leonie lieselotte lina lisa luise magdalena maja
manuela margarete margit maria marianne marie marina marion marlene martha martina mechthild melanie merve michaela miriam monika nadine nadja natalie
nicole nina olga patricia paula petra pia rebecca regina renate rita rosemarie ruth sabine sabrina sandra sara sarah silke silvia simone sonja sophie
stefanie stephanie susanne svenja swetlana tamara tanja tatjana theresa ulrike ursula ute vanessa vera verena viktoria waltraud wiebke yvonne zeynep
anastasia irina ludmila natalia oksana galina svetlana elif hatice hülya meryem özlem sevgi songül sibel derya dilek ebru gamze gülsen leyla nur
selin büsra fadime ewa agnieszka katarzyna malgorzata joanna beata dorota grazyna krystyna barbora francesca giulia chiara alessandra federica
lucia elena-maria valentina silvana rosa ana isabel carla mariana fernanda beatriz teresa fatima amina aisha mariam yasmin
`;
/** Vornamen, die es für Männer und Frauen gibt – hier wird nichts geschlossen. */
const AMBIGUOUS = new Set("andrea kim deniz sascha toni nikola alexis jo chris sam robin luca-maria maxi eike kai-uwe ümit aydin evren nur-ali yildiz gül".split(" "));

const plain = (value: string) => value.trim().toLowerCase().normalize("NFC");
const toSet = (list: string) => new Set(list.split(/\s+/).map(plain).filter(Boolean));
const MALE_SET = toSet(MALE); const FEMALE_SET = toSet(FEMALE);

/** „Herr“, „Frau“ oder null (nicht eindeutig oder unbekannt). Doppelnamen („Hans-Peter“) zählen nach dem ersten Teil. */
export function salutationFromFirstName(firstName: string | null | undefined): "Herr" | "Frau" | null {
  if (!firstName) return null;
  const whole = plain(firstName).replace(/\s+/g, " ");
  const candidates = [whole, whole.split(/[\s-]/)[0]];
  for (const name of candidates) {
    if (!name || AMBIGUOUS.has(name)) return null;
    const male = MALE_SET.has(name); const female = FEMALE_SET.has(name);
    if (male !== female) return male ? "Herr" : "Frau";
  }
  return null;
}
