import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Pencil, Plus, Trash2, TriangleAlert, X } from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError, useApi } from "@/lib/api"
import type { SaveVocabularyEntryRequest, VocabularyEntry, VocabularySlug } from "@/lib/types"

/**
 * Envars — the names a patient reads that no translation file can reach.
 *
 * **The screen says "Envars"; the API path and the types still say
 * "vocabulary".** That is deliberate rather than half-finished: the HTTP path
 * is wired to explicit API Gateway resources, so renaming it means recreating
 * them, and having the client call one name while the wire uses another would
 * be exactly the second-name-for-the-same-thing that migration 010 argues
 * against. Renaming end to end is a small, separate change if it is wanted.
 *
 * **Why this page exists.** Everything the app writes itself lives in
 * `locales/*.json` and is edited on the Translations page. These four are
 * different: they are *rows*, so a gender or a medicine name went out in
 * whatever language somebody typed, and a profile in 中文 still read "Male".
 * They cannot be fixed by adding a key, because a medicine added this afternoon
 * has no key and never will — the translation has to live beside the row.
 *
 * Editing is inline rather than in a dialog, because the job is almost always
 * "fill in the missing Chinese for these four", and a dialog per row turns a
 * two-minute pass into forty clicks.
 */

/**
 * The one column a vocabulary may carry beyond the name pair. Two of the four
 * have one, and describing it here rather than branching on the slug is what
 * keeps a single editor serving all of them.
 */
type ExtraColumn = { key: "default_dosage" | "units"; label: string; placeholder: string }

const TABS: {
  slug: VocabularySlug
  label: string
  blurb: string
  extra?: ExtraColumn
  /** `tests` alone is keyed by something worth reading; see its blurb. */
  showSlot?: boolean
}[] = [
  { slug: "genders", label: "Genders", blurb: "Shown on the signup form and the profile screen." },
  { slug: "conditions", label: "Conditions", blurb: "Shown on the signup form and the profile screen." },
  {
    slug: "medications",
    label: "Medication library",
    blurb: "Shown wherever a reminder names its medicine, including the alarm itself.",
    extra: { key: "default_dosage", label: "Dosages", placeholder: "e.g. 200mg, 500mg" },
  },
  {
    slug: "tests",
    label: "Test results",
    // The field number is surfaced rather than hidden because it is not a row
    // id: it is the column in `test_results` the readings live in, so it
    // explains why a test cannot be reordered and why deleting one that has
    // readings is refused. Staff who never look at it lose nothing.
    blurb:
      "Named on the results dashboard — under the chart, on the quick-stat cards and beside every reading. " +
      "The field number is the column each test's readings are stored in: it is assigned when you add the test and fixed afterwards, " +
      "and a test with readings has to be renamed rather than deleted.",
    extra: { key: "units", label: "Units", placeholder: "e.g. mmol/L (optional)" },
    showSlot: true,
  },
]

export function EnvarsPage() {
  const [active, setActive] = useState<VocabularySlug>("genders")
  const tab = TABS.find((t) => t.slug === active)!

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Envars</h1>
        <p className="text-sm text-muted-foreground">
          Names that come from the database rather than the translation files — so they need
          translating here. Entries without Chinese still work: the app falls back to English.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.slug}
            variant={t.slug === active ? "default" : "outline"}
            size="sm"
            onClick={() => setActive(t.slug)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <EnvarEditor
        key={active}
        slug={active}
        label={tab.label}
        blurb={tab.blurb}
        extra={tab.extra}
        showSlot={!!tab.showSlot}
      />
    </div>
  )
}

function EnvarEditor({
  slug, label, blurb, extra, showSlot,
}: { slug: VocabularySlug; label: string; blurb: string; extra?: ExtraColumn; showSlot: boolean }) {
  const api = useApi()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ["vocabulary", slug], queryFn: () => api.listVocabulary(slug) })

  const [editing, setEditing] = useState<number | "new" | null>(null)
  const [draft, setDraft] = useState<SaveVocabularyEntryRequest>({ name_en: "", name_zh_hant: null })
  const [error, setError] = useState<string | null>(null)

  const entries = query.data?.entries ?? []
  const untranslated = entries.filter((e) => !e.name_zh_hant?.trim()).length

  const done = () => {
    setEditing(null)
    setError(null)
    qc.invalidateQueries({ queryKey: ["vocabulary", slug] })
  }
  // The API's 409s are the useful ones — a duplicate name, or an entry somebody
  // is still using — so they are surfaced verbatim rather than flattened into
  // "something went wrong".
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e))

  const save = useMutation({
    mutationFn: (req: SaveVocabularyEntryRequest) =>
      editing === "new"
        ? api.createVocabularyEntry(slug, req)
        : api.updateVocabularyEntry(slug, editing as number, req),
    onSuccess: done,
    onError: fail,
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteVocabularyEntry(slug, id),
    onSuccess: done,
    onError: fail,
  })

  const startEdit = (entry: VocabularyEntry) => {
    setError(null)
    setEditing(entry.id)
    setDraft({
      name_en: entry.name_en,
      name_zh_hant: entry.name_zh_hant,
      ...(extra ? { [extra.key]: entry[extra.key] ?? "" } : {}),
    })
  }

  const startNew = () => {
    setError(null)
    setEditing("new")
    setDraft({ name_en: "", name_zh_hant: null, ...(extra ? { [extra.key]: "" } : {}) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {label}
          {untranslated > 0 ? (
            <Badge variant="outline" className="gap-1 font-normal">
              <TriangleAlert className="h-3 w-3" />
              {untranslated} without Chinese
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{blurb}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {query.isPending ? <Skeleton className="h-40 w-full" /> : null}
        {query.error ? (
          <p className="text-sm text-destructive">Couldn&apos;t load: {(query.error as Error).message}</p>
        ) : null}
        {error ? (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        ) : null}

        {query.data ? (
          <Table>
            <TableHeader>
              <TableRow>
                {showSlot ? <TableHead className="w-[70px]">Field</TableHead> : null}
                <TableHead>English</TableHead>
                <TableHead>繁體中文</TableHead>
                {extra ? <TableHead>{extra.label}</TableHead> : null}
                <TableHead className="w-[130px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) =>
                editing === entry.id ? (
                  <EditRow
                    key={entry.id}
                    draft={draft}
                    setDraft={setDraft}
                    extra={extra}
                    showSlot={showSlot}
                    slot={entry.id}
                    busy={save.isPending}
                    onSave={() => save.mutate(draft)}
                    onCancel={() => { setEditing(null); setError(null) }}
                  />
                ) : (
                  <TableRow key={entry.id}>
                    {showSlot ? (
                      <TableCell className="tabular-nums text-muted-foreground">{entry.id}</TableCell>
                    ) : null}
                    <TableCell className="font-medium">{entry.name_en}</TableCell>
                    <TableCell>
                      {entry.name_zh_hant?.trim() ? (
                        entry.name_zh_hant
                      ) : (
                        // Named rather than left blank: an empty cell reads as a
                        // rendering fault, and this is the whole point of the page.
                        <span className="text-muted-foreground">— not translated</span>
                      )}
                    </TableCell>
                    {extra ? <TableCell className="text-muted-foreground">{entry[extra.key]}</TableCell> : null}
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(entry)} aria-label={`Edit ${entry.name_en}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(entry.id)}
                        aria-label={`Delete ${entry.name_en}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              )}

              {editing === "new" ? (
                <EditRow
                  draft={draft}
                  setDraft={setDraft}
                  extra={extra}
                  showSlot={showSlot}
                  // Nothing to show yet: the server picks the lowest free slot
                  // when the row is inserted, and guessing it here would be a
                  // number the editor invented.
                  slot={null}
                  busy={save.isPending}
                  onSave={() => save.mutate(draft)}
                  onCancel={() => { setEditing(null); setError(null) }}
                />
              ) : null}
            </TableBody>
          </Table>
        ) : null}

        {editing === null ? (
          <Button variant="outline" size="sm" onClick={startNew}>
            <Plus className="mr-2 h-4 w-4" />
            Add entry
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function EditRow({
  draft, setDraft, extra, showSlot, slot, busy, onSave, onCancel,
}: {
  draft: SaveVocabularyEntryRequest
  setDraft: (d: SaveVocabularyEntryRequest) => void
  extra?: ExtraColumn
  showSlot: boolean
  /** null while adding: the server picks the slot, so the editor cannot show one yet. */
  slot: number | null
  busy: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <TableRow>
      {showSlot ? (
        <TableCell className="tabular-nums text-muted-foreground">
          {slot ?? <span title="Assigned when you save">—</span>}
        </TableCell>
      ) : null}
      <TableCell>
        <Label className="sr-only" htmlFor="name_en">English name</Label>
        <Input
          id="name_en"
          value={draft.name_en}
          autoFocus
          placeholder="English name (required)"
          onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
        />
      </TableCell>
      <TableCell>
        <Label className="sr-only" htmlFor="name_zh_hant">Chinese name</Label>
        <Input
          id="name_zh_hant"
          value={draft.name_zh_hant ?? ""}
          placeholder="繁體中文 (optional)"
          onChange={(e) => setDraft({ ...draft, name_zh_hant: e.target.value || null })}
        />
      </TableCell>
      {extra ? (
        <TableCell>
          <Label className="sr-only" htmlFor={extra.key}>{extra.label}</Label>
          <Input
            id={extra.key}
            value={draft[extra.key] ?? ""}
            placeholder={extra.placeholder}
            onChange={(e) => setDraft({ ...draft, [extra.key]: e.target.value })}
          />
        </TableCell>
      ) : null}
      <TableCell className="text-right">
        <Button size="sm" disabled={busy || !draft.name_en.trim()} onClick={onSave} aria-label="Save entry">
          <Check className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel} aria-label="Cancel">
          <X className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  )
}
