import * as fs from "fs";
import { nanoid } from "nanoid";
import { addItem } from "../queue/queueStore";
import { Report, subReport } from "../tasks/tasks";
import { getSettings } from "../settings/appSettings";
import { buildComboReel, comboCaption } from "../render/comboReel";
import { fetchCombo, markComboPosted, pickCombo } from "./spellbook";

const noop: Report = () => undefined;

/**
 * Combo-Reel als Entwurf anlegen.
 *  - input = Commander-Spellbook-Link oder -ID: genau diese Combo
 *  - ohne input: beliebte, noch nicht verwendete Combo im Budget
 * Die Combo wird sofort als verwendet gemerkt. Wird der Entwurf abgelehnt,
 * holt die Automatik fuer den Tag eine andere.
 */
export async function draftCombo(when: Date, input?: string, report: Report = noop): Promise<{ label: string; scheduledAt: string }> {
  report(input ? "Lade Combo von Commander Spellbook" : "Suche eine neue Combo", 0.02);
  const combo = input?.trim() ? await fetchCombo(input) : await pickCombo(Math.max(10, getSettings().budgetMaxEur));
  const { video, cover } = await buildComboReel(combo, subReport(report, 0.08, 0.97));
  const ig = comboCaption(combo);
  const label = `Combo: ${combo.cards.map((c) => c.shortName).join(" + ")}`;
  addItem({
    id: nanoid(10),
    kind: "reel",
    status: "draft",
    createdAt: new Date().toISOString(),
    scheduledAt: when.toISOString(),
    mediaToken: nanoid(24),
    mediaFiles: cover && fs.existsSync(cover) ? [video, cover] : [video],
    caption: ig.caption,
    firstComment: ig.firstComment,
    keywords: ig.keywords,
    comboId: combo.id,
    label,
  });
  markComboPosted(combo);
  console.log(`[combo] drafted ${label} (${combo.id}) for ${when.toISOString()}`);
  return { label, scheduledAt: when.toISOString() };
}
