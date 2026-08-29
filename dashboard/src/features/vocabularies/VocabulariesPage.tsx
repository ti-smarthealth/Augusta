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
 * The vocabularies a patient reads but no translation file can reach.
 *
 * **Why this page exists.** Everything the app writes itself lives in
 * `locales/*.json` and is edited on the Translations page. These three are
 * different: they are *rows*, so a gender or a medicine name went out in
 * whatever language somebody typed, and a profile in 中文 still read "Male".
 * They cannot be fixed by adding a key, because a medicine added this afternoon
 * has no key and never will — the translation has to live beside the row.
 *
 * Editing is inline rather than in a dialog, because the job is almost always
 * "fill in the missing Chinese for these four", and a dialog per row turns a
 * two-minute pass into forty clicks.
 */

const TABS: { slug: VocabularySlug; label: string; blurb: string; hasDosage?: boolean }[] = [
  { slug: "genders", label: "Genders", blurb: "Shown on the signup form and the profile screen." },
  { slug: "conditions", label: "Conditions", blurb: "Shown on the signup form and the profile screen." },
  {
    slug: "medications",
    label: "Medication library",
    blurb: "Shown wherever a reminder names its medicine, including the alarm itself.",
    hasDosage: true,
  },
]

export function VocabulariesPage() {
  const [active, setActive] = useState<VocabularySlug>("genders")
  const tab = TABS.find((t) => t.slug === active)!

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vocabularies</h1>
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

      <VocabularyEditor key={active} slug={active} label={tab.label} blurb={tab.blurb} hasDosage={!!tab.hasDosage} />
    </div>
  )
}

function VocabularyEditor({
  slug, label, blurb, hasDosage,
}: { slug: VocabularySlug; label: string; blurb: string; hasDosage: boolean }) {
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
      ...(hasDosage ? { default_dosage: entry.default_dosage ?? "" } : {}),
    })
  }

  const startNew = () => {
    setError(null)
    setEditing("new")
    setDraft({ name_en: "", name_zh_hant: null, ...(hasDosage ? { default_dosage: "" } : {}) })
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
                <TableHead>English</TableHead>
                <TableHead>繁體中文</TableHead>
                {hasDosage ? <TableHead>Dosages</TableHead> : null}
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
                    hasDosage={hasDosage}
                    busy={save.isPending}
                    onSave={() => save.mutate(draft)}
                    onCancel={() => { setEditing(null); setError(null) }}
                  />
                ) : (
                  <TableRow key={entry.id}>
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
                    {hasDosage ? <TableCell className="text-muted-foreground">{entry.default_dosage}</TableCell> : null}
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
                  hasDosage={hasDosage}
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
  draft, setDraft, hasDosage, busy, onSave, onCancel,
}: {
  draft: SaveVocabularyEntryRequest
  setDraft: (d: SaveVocabularyEntryRequest) => void
  hasDosage: boolean
  busy: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <TableRow>
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
      {hasDosage ? (
        <TableCell>
          <Input
            value={draft.default_dosage ?? ""}
            placeholder="e.g. 200mg, 500mg"
            onChange={(e) => setDraft({ ...draft, default_dosage: e.target.value })}
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
