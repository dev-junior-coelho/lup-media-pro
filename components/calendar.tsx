"use client";
import { useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { statusNames, typeNames } from "@/lib/shared/presentation";
import type { Post, Account } from "@/lib/shared/schema";
export function Calendar({
  posts,
  timezone,
  onDay,
  onEdit,
  full = false,
  accounts = [],
}: {
  posts: Post[];
  accounts?: Account[];
  timezone: string;
  onDay: (day: string) => void;
  onEdit: (p: Post) => void;
  full?: boolean;
}) {
  const localToday = () =>
    new Date(
      `${formatInTimeZone(new Date(), timezone, "yyyy-MM-dd")}T12:00:00`,
    );
  const [month, setMonth] = useState(localToday),
    [view, setView] = useState("month");
  const y = month.getFullYear(),
    m = month.getMonth(),
    today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const start =
    view === "week"
      ? new Date(y, m, month.getDate() - month.getDay())
      : new Date(y, m, 1 - new Date(y, m, 1).getDay());
  const count = view === "week" ? 7 : 42;
  const days = Array.from(
    { length: count },
    (_, i) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
  const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function change(delta: number) {
    setMonth(
      view === "week"
        ? new Date(y, m, month.getDate() + delta * 7)
        : new Date(y, m + delta, 1),
    );
  }
  return (
    <section className="procard">
      <div className="protitle">
        <h2>
          <CalendarDays size={17} /> Calendário de conteúdo
        </h2>
        <div className="calendarcontrols">
          <button
            className="calnav"
            aria-label="Período anterior"
            onClick={() => change(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="monthlabel">
            {month.toLocaleDateString("pt-BR", {
              month: "long",
              year: "numeric",
            })}
          </span>
          <button
            className="calnav"
            aria-label="Próximo período"
            onClick={() => change(1)}
          >
            <ChevronRight size={16} />
          </button>
          <button className="linebutton" onClick={() => setMonth(localToday())}>
            Hoje
          </button>
        </div>
      </div>
      {full && (
        <div className="togglegroup toolbar">
          {[
            ["month", "Mês"],
            ["week", "Semana"],
            ["list", "Lista"],
          ].map(([v, label]) => (
            <button
              key={v}
              className={`typechoice ${view === v ? "active" : ""}`}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {view === "list" ? (
        <div className="itemlist">
          {!posts.some(
            (p) =>
              p.scheduledAt &&
              Number.isFinite(Date.parse(p.scheduledAt)) &&
              formatInTimeZone(p.scheduledAt, timezone, "yyyy-MM") ===
                `${y}-${String(m + 1).padStart(2, "0")}`,
          ) && <p className="empty-state">Nenhuma publicação neste mês.</p>}
          {posts
            .filter(
              (p) =>
                p.scheduledAt &&
                Number.isFinite(Date.parse(p.scheduledAt)) &&
                formatInTimeZone(p.scheduledAt, timezone, "yyyy-MM") ===
                  `${y}-${String(m + 1).padStart(2, "0")}`,
            )
            .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))
            .map((p) => (
              <button
                className="linebutton"
                key={p.id}
                onClick={() => onEdit(p)}
              >
                {formatInTimeZone(p.scheduledAt!, timezone, "dd/MM HH:mm")} •{" "}
                {p.caption.slice(0, 50) || typeNames[p.type]} •{" "}
                {statusNames[p.status]}
              </button>
            ))}
        </div>
      ) : (
        <div className={`calendargrid calendar-${view}`}>
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((v) => (
            <div className="weekday" key={v}>
              {v}
            </div>
          ))}
          {days.map((d) => {
            const key = local(d),
              events = posts.filter(
                (p) =>
                  p.scheduledAt &&
                  Number.isFinite(Date.parse(p.scheduledAt)) &&
                  formatInTimeZone(p.scheduledAt, timezone, "yyyy-MM-dd") ===
                    key,
              );
            return (
              <div
                key={key}
                className={`daycell ${d.getMonth() !== m ? "outside" : ""} ${key === today ? "is-today" : ""}`}
              >
                <button
                  className="day-add"
                  aria-label={`Criar agendamento em ${key}`}
                  onClick={() => onDay(key)}
                >
                  <span className="daynum">{d.getDate()}</span>
                </button>
                {events.slice(0, 3).map((p) => (
                  <button
                    key={p.id}
                    className={`calevent ${p.type} ${p.status}`}
                    onClick={() => onEdit(p)}
                    title={`${p.caption} • ${statusNames[p.status]}`}
                  >
                    {formatInTimeZone(p.scheduledAt!, timezone, "HH:mm")}{" "}
                    {typeNames[p.type]} • {statusNames[p.status]}{" "}
                    {accounts.find((account) => account.id === p.accountId)
                      ?.username
                      ? `· @${accounts.find((account) => account.id === p.accountId)!.username}`
                      : ""}
                  </button>
                ))}
                {events.length > 3 && <span>+{events.length - 3}</span>}
              </div>
            );
          })}
        </div>
      )}
      <p className="calendarhint">
        Toque no dia para agendar. Horários em {timezone}.
      </p>
    </section>
  );
}
