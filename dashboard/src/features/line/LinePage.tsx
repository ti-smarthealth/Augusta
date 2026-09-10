import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Clock, MessagesSquare, Radio, Send, User, Users, XCircle } from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useApi } from "@/lib/api"
import type { LineKind, LineMessageRow, LineResult } from "@/lib/types"

/**
 * The LINE bot console — a development and testing surface, not an operator
 * tool.
 *
 * **Every button here goes through `tish-line-send`**, the same function the
 * product uses. That is the whole point: a console with its own copy of the LINE
 * client would prove its own code works and nothing about the path a real
 * escalation takes. It is also why a failure renders in full — status, LINE's
 * own message, and the request id support will ask for — rather than as a toast
 * saying something went wrong.
 *
 * **The log records attempts, not successes.** A row that is still `queued`
 * minutes later is a send that was issued and never came back, which is the
 * failure a success-only log shows as nothing at all. The stuck count is
 * surfaced above the table for exactly that reason.
 */

/**
 * How each kind addresses its recipients. Mirrors `TARGETING` in
 * `line/send/line-api.mjs`; the form is rendered from this so a kind that takes
 * no target cannot grow a target field, and multicast cannot quietly accept one.
 */
const KINDS: {
  kind: LineKind
  label: string
  targeting: "token" | "one" | "many" | "none" | "audience"
  hint: string
  danger?: boolean
  /** Present means the kind cannot be driven from here; the text says why. */
  disabled?: string
}[] = [
  { kind: "push", label: "Push", targeting: "one", hint: "One userId, groupId or roomId. Costs quota." },
  { kind: "multicast", label: "Multicast", targeting: "many", hint: "Up to 500 userIds, comma separated. Individuals only — a groupId here is a 400." },
  {
    kind: "reply",
    label: "Reply",
    targeting: "token",
    hint: "Replies are how the bot answers inbound messages, and they cost no quota — but they cannot be driven by hand from here.",
    // **Not hidden, because the capability is real and worth documenting.** The
    // bot replies constantly; what is impossible is doing it from a console.
    disabled:
      "A reply token exists only inside an inbound webhook event, is single-use, " +
      "and expires in about a minute. The webhook has already spent it answering " +
      "the message, so there is never a live token to paste here.",
  },
  { kind: "narrowcast", label: "Narrowcast", targeting: "audience", hint: "Targets an audience object. Asynchronous — a 202 means accepted, not delivered, and LINE enforces a minimum audience size." },
  { kind: "broadcast", label: "Broadcast", targeting: "none", hint: "Every follower of the account. No undo, no recipient list to review.", danger: true },
]

/**
 * The three kinds of conversation LINE can put the bot in, and how each is
 * presented.
 *
 * **`linkable` is the load-bearing field.** A user can be bound to a TISH
 * account by redeeming a code; a group or room **cannot be, ever** — a group has
 * no single owner, so `user_id` stays null by design rather than by omission.
 * Showing "not linked with app" against one would claim something is missing and
 * fixable when it is structurally impossible.
 */
const SOURCE_TYPES = [
  { type: "user", heading: "Friends", icon: User, linkable: true, empty: "Nobody has messaged the bot yet." },
  { type: "group", heading: "Groups", icon: Users, linkable: false, empty: null },
  { type: "room", heading: "Rooms", icon: MessagesSquare, linkable: false, empty: null },
] as const

/** The icon for a row, so the composer and the list agree on what a type looks like. */
function iconFor(sourceType: string) {
  return SOURCE_TYPES.find((s) => s.type === sourceType)?.icon ?? User
}

const STATUS: Record<LineMessageRow["status"], { icon: typeof CheckCircle2; tone: string; label: string }> = {
  sent: { icon: CheckCircle2, tone: "text-muted-foreground", label: "Sent" },
  failed: { icon: XCircle, tone: "text-destructive", label: "Failed" },
  queued: { icon: Clock, tone: "text-amber-600", label: "Queued" },
}

export function LinePage() {
  const api = useApi()
  const qc = useQueryClient()

  const [kind, setKind] = useState<LineKind>("push")
  const [to, setTo] = useState("")
  const [text, setText] = useState("")
  const [replyToken, setReplyToken] = useState("")
  const [confirm, setConfirm] = useState("")
  const [result, setResult] = useState<LineResult | null>(null)

  const status = useQuery({ queryKey: ["line", "status"], queryFn: api.getLineStatus })
  const recipients = useQuery({ queryKey: ["line", "recipients"], queryFn: api.getLineRecipients })
  const log = useQuery({
    queryKey: ["line", "log"],
    queryFn: api.getLineLog,
    // This is the page someone leaves open while poking the bot from their phone.
    refetchInterval: 10000,
  })

  const send = useMutation({
    mutationFn: api.sendLineMessage,
    onSuccess: (r) => {
      setResult(r)
      setConfirm("")
      qc.invalidateQueries({ queryKey: ["line", "log"] })
    },
    // A network-level failure still has to render as a result rather than
    // disappearing — the console's job is to say what happened either way.
    onError: (e: Error) => setResult({ ok: false, error: e.message }),
  })

  const active = KINDS.find((k) => k.kind === kind)!
  const needsConfirm = active.danger && confirm !== "BROADCAST"

  const bot = status.data?.info?.data
  const quota = status.data?.quota?.data
  const audiences = status.data?.audiences?.data?.audienceGroups ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">LINE bot</h1>
        <p className="text-sm text-muted-foreground">
          Development console. Every send here runs through the same function the product uses.
        </p>
      </div>

      {/* Identity and quota. Cheapest possible proof the token is valid and
          points at the channel somebody thinks it does — a bot answering with an
          unexpected basicId is the failure otherwise discovered by messaging the
          wrong customers. */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Bot identity</CardDescription>
          </CardHeader>
          <CardContent>
            {status.isLoading ? (
              <Skeleton className="h-6 w-32" />
            ) : bot ? (
              <>
                <CardTitle className="text-lg">{bot.displayName}</CardTitle>
                <p className="font-mono text-xs text-muted-foreground">{bot.basicId}</p>
              </>
            ) : (
              <p className="text-sm text-destructive">
                {status.data?.info?.error ?? "Could not reach LINE. Is LINE_CHANNEL_ACCESS_TOKEN set?"}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Message quota</CardDescription>
          </CardHeader>
          <CardContent>
            {quota ? (
              <>
                <CardTitle className="text-lg">
                  {quota.consumption?.totalUsage ?? 0}
                  {quota.quota?.value != null ? ` / ${quota.quota.value}` : ""}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {quota.quota?.type === "none" ? "Unlimited plan" : "Used this month"}
                </p>
              </>
            ) : (
              <Skeleton className="h-6 w-24" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Known recipients</CardDescription>
          </CardHeader>
          <CardContent>
            <CardTitle className="text-lg">{recipients.data?.recipients.length ?? 0}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {recipients.data?.recipients.filter((r) => r.user_id).length ?? 0} linked to a TISH account
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Composer */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4" /> Send a test message
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              // The span carries the tooltip: a disabled button does not fire
              // mouse events in every browser, so a `title` on it alone would
              // silently show nothing in some of them — which for an explanation
              // of *why* something is disabled is the whole point lost.
              <span key={k.kind} title={k.disabled ?? undefined} className={k.disabled ? "cursor-not-allowed" : undefined}>
                <Button
                  type="button"
                  size="sm"
                  disabled={Boolean(k.disabled)}
                  variant={kind === k.kind ? "default" : "outline"}
                  onClick={() => { setKind(k.kind); setResult(null) }}
                >
                  {k.kind === "broadcast" ? <Radio className="mr-1 h-3 w-3" /> : null}
                  {k.label}
                </Button>
              </span>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">{active.hint}</p>

          {active.targeting === "one" || active.targeting === "many" ? (
            <div className="space-y-1">
              <Label htmlFor="line-to">{active.targeting === "many" ? "User ids (comma separated)" : "Recipient id"}</Label>
              <Input id="line-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="U1234…" />
              {/* Real addressees, so nobody has to paste an opaque id out of a log. */}
              {recipients.data?.recipients.length ? (
                <div className="flex flex-wrap gap-1 pt-1">
                  {recipients.data.recipients.slice(0, 8).map((r) => {
                    // Same icon as the list below, so a groupId is recognisable
                    // as one here — multicast rejects groups, and an id that
                    // looks like any other is how that mistake gets made.
                    const RowIcon = iconFor(r.source_type)
                    return (
                      <Button
                        key={r.line_user_id}
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs"
                        onClick={() => setTo(r.line_user_id)}
                      >
                        <RowIcon className="mr-1 h-3 w-3" />
                        {r.full_name ?? r.display_name ?? r.line_user_id.slice(0, 10)}
                      </Button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {active.targeting === "token" ? (
            <div className="space-y-1">
              <Label htmlFor="line-token">Reply token</Label>
              <Input id="line-token" value={replyToken} onChange={(e) => setReplyToken(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Single use and short-lived. Expect a 400 if the event it came from is more than a minute old.
              </p>
            </div>
          ) : null}

          {active.targeting === "audience" ? (
            <div className="space-y-1">
              <Label>Audience</Label>
              {audiences.length ? (
                <div className="flex flex-wrap gap-1">
                  {audiences.map((a) => (
                    <Button key={a.audienceGroupId} type="button" size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setTo(String(a.audienceGroupId))}>
                      {a.description} ({a.audienceCount})
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No audience groups on this channel. Narrowcast needs one, and LINE enforces a minimum size —
                  for a handful of caregivers, multicast is the right primitive instead.
                </p>
              )}
            </div>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="line-text">Message</Label>
            <Textarea id="line-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-xs text-muted-foreground">{text.length} / 5000 characters</p>
          </div>

          {/* Type-to-confirm rather than one click. The server enforces this too:
              a confirmation that only exists in the browser is one a scripted
              call skips. */}
          {active.danger ? (
            <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <Label htmlFor="line-confirm" className="text-destructive">
                This reaches every follower and cannot be undone. Type BROADCAST to enable.
              </Label>
              <Input id="line-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          ) : null}

          <Button
            disabled={send.isPending || !text.trim() || needsConfirm}
            onClick={() =>
              send.mutate({
                kind,
                text,
                to: active.targeting === "many" ? to.split(",").map((s) => s.trim()).filter(Boolean) : to || undefined,
                replyToken: replyToken || undefined,
                recipient: active.targeting === "audience" && to ? { type: "audience", audienceGroupId: Number(to) } : undefined,
                confirm: active.danger ? confirm : undefined,
              })
            }
          >
            {send.isPending ? "Sending…" : `Send ${active.label.toLowerCase()}`}
          </Button>

          {result ? (
            <div className={`rounded-md border p-3 text-sm ${result.ok ? "bg-muted" : "border-destructive/40 bg-destructive/5"}`}>
              <p className="font-medium">{result.ok ? "LINE accepted it" : "LINE refused it"}</p>
              {result.error ? <p className="mt-1 font-mono text-xs break-all">{result.error}</p> : null}
              {result.requestId ? (
                <p className="mt-1 font-mono text-xs text-muted-foreground">request id: {result.requestId}</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Who the bot knows about.
          **Event-sourced, and the UI has to say so**, because the alternative
          reading of an empty list is "the bot is broken". LINE will not tell us
          who follows the account — `followers/ids` is refused on this plan — so
          this table only ever contains people the bot has actually heard from.
          Anyone who added it before the webhook went live is invisible until
          they next send a message. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Friends and groups
          </CardTitle>
          <CardDescription>
            Built from webhook events, not queried from LINE — this account cannot list its own
            followers, so somebody appears here the first time they message the bot or add it to a group.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recipients.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !recipients.data?.recipients.length ? (
            <p className="text-sm text-muted-foreground">
              Nobody yet. Send the bot a message from LINE and it will appear here.
            </p>
          ) : (
            <div className="space-y-5">
              {SOURCE_TYPES.map(({ type, heading, icon: TypeIcon, linkable }) => {
                const rows = recipients.data.recipients.filter((r) => r.source_type === type)
                if (!rows.length) return null
                return (
                  <div key={type}>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                      <TypeIcon className="h-3.5 w-3.5" />
                      {heading} ({rows.length})
                    </p>
                    <div className="divide-y">
                      {rows.map((r) => (
                        <div key={r.line_user_id} className="flex items-start gap-3 py-2 text-sm">
                          <TypeIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">
                                {r.full_name ?? r.display_name ?? "Unnamed"}
                              </span>
                              {/* **Only users carry a link badge.** A group has no
                                  single owner, so its null user_id is by design —
                                  labelling it "not linked" would report a missing
                                  step that does not exist. */}
                              {r.user_id ? (
                                <Badge variant="outline" className="text-xs">
                                  TISH #{r.user_id}{r.locale ? ` · ${r.locale}` : ""}
                                </Badge>
                              ) : linkable ? (
                                // An unlinked friend cannot be reached by any
                                // product event — no escalation, no reminder — only
                                // by a manual push from this page. Worth saying.
                                <Badge variant="secondary" className="text-xs">not linked with app</Badge>
                              ) : null}
                              {r.unfollowed_at ? (
                                <Badge variant="destructive" className="text-xs">
                                  {linkable ? "blocked" : "left"}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="truncate font-mono text-xs text-muted-foreground">{r.line_user_id}</p>
                          </div>
                          <div className="shrink-0 text-right text-xs text-muted-foreground">
                            <div>{r.message_count} sent</div>
                            <div>{new Date(r.linked_at).toLocaleDateString()}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending outbox — work the bot owes but has not done. */}
      {log.data?.pending.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pending actions ({log.data.pending.length})</CardTitle>
            <CardDescription>Queued inside the VPC, waiting for the sender to drain them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {log.data.pending.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b py-1 text-sm last:border-0">
                <span className="font-mono text-xs">{p.kind} → {p.target ?? "—"}</span>
                <span className="text-xs text-muted-foreground">
                  {p.reason} · {p.attempts} attempt{p.attempts === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Message log</CardTitle>
          <CardDescription>
            Attempts, not just successes — a row stuck at Queued is a send that never reported back.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {log.data && log.data.stuckCount > 0 ? (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              {log.data.stuckCount} send{log.data.stuckCount === 1 ? "" : "s"} stuck at Queued for over five minutes.
            </div>
          ) : null}

          {log.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !log.data?.messages.length ? (
            <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
          ) : (
            <div className="divide-y">
              {log.data.messages.map((m) => {
                const s = STATUS[m.status]
                const Icon = s.icon
                return (
                  <div key={m.id} className="flex items-start gap-3 py-2 text-sm">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.tone}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-xs">{m.kind}</Badge>
                        <span className="truncate font-mono text-xs text-muted-foreground">{m.target ?? "all followers"}</span>
                      </div>
                      {m.payload ? <p className="mt-1 truncate text-xs">{m.payload}</p> : null}
                      {m.error ? <p className="mt-1 break-all text-xs text-destructive">{m.error}</p> : null}
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <div>{new Date(m.created_at).toLocaleString()}</div>
                      {m.triggered_by ? <div className="truncate">{m.triggered_by}</div> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
