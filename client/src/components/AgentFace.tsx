import { AvatarContent } from "@/components/AvatarUpload";
import { initialsOf } from "../../../shared/avatar";

/** Farbton eines Agenten – immer derselbe je Name, damit man ihn wiedererkennt (bewusst keine Ampelfarben). */
export const toneOf = (name: string) => { let hash = 0; for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0; return hash % 6; };
/** Kreis eines Agenten: Profilbild – oder die Anfangsbuchstaben im Farbton des Namens. */
export const AgentFace = ({ name, avatarUrl, className = "" }: { name: string; avatarUrl?: string | null; className?: string }) => <span className={`gq-who is-tone-${toneOf(name)} ${className}`.trim()} aria-hidden="true"><AvatarContent avatarUrl={avatarUrl} initials={initialsOf(name)} /></span>;
/** Schmaler Balken: Anteile freigegeben / zur Prüfung / zurückgewiesen / offen. */
export const Split = ({ approved, review, rejected, open }: { approved: number; review: number; rejected: number; open: number }) => <span className="gq-split" aria-hidden="true">{approved > 0 && <i className="is-approved" style={{ flexGrow: approved }} />}{review > 0 && <i className="is-review" style={{ flexGrow: review }} />}{rejected > 0 && <i className="is-rejected" style={{ flexGrow: rejected }} />}{open > 0 && <i className="is-open" style={{ flexGrow: open }} />}</span>;
