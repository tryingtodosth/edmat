//! EdMat API — the Rust port (PORTS-BRIEF.md, branch `port/rust`).
//!
//! Milestone M0: the anonymous taxonomy read surface, conformance-defined — this binary's whole
//! definition of correct is `node spec/conformance/run.mjs http://127.0.0.1:8090` passing the same
//! goldens the Django reference passes. The schema is Django's (`spec/schema.sql`); this process
//! opens the database READ-ONLY at the SQLite level, so the port cannot write even by mistake —
//! writes stay Django's until the milestone that ports them arrives with their validation.
//!
//! Locale resolution mirrors `backend/config/i18n_utils.py` exactly: `?lang=` requested locale,
//! falling back to 'pl' (the original corpus locale — deliberately not 'en', which was once a real
//! bug there), then to any available row, then to none (name falls back to the slug, description
//! to the empty string, a chapter title to "Chapter {number}").

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use axum::routing::get;
use axum::Router;
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};

struct App {
    db_path: String,
}

type Ctx = State<Arc<App>>;

fn open(app: &App) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        &app.db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
}

/// `i18n_utils.resolve_translation`: requested locale, else 'pl', else the first row there is.
/// Rows arrive ordered by id, matching the insertion order Python's dict preserved.
fn resolve<'a>(rows: &'a [(String, Vec<String>)], lang: &str) -> Option<&'a Vec<String>> {
    rows.iter()
        .find(|(l, _)| l == lang)
        .or_else(|| rows.iter().find(|(l, _)| l == "pl"))
        .or_else(|| rows.iter().next())
        .map(|(_, v)| v)
}

/// All translation rows for one owning row, ordered by id, selected columns per table.
fn translations(
    conn: &Connection,
    table: &str,
    fk: &str,
    id: i64,
    cols: &[&str],
) -> rusqlite::Result<Vec<(String, Vec<String>)>> {
    let sql = format!(
        "SELECT locale, {} FROM {table} WHERE {fk} = ?1 ORDER BY id",
        cols.join(", ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([id], |row| {
        let locale: String = row.get(0)?;
        let mut vals = Vec::with_capacity(cols.len());
        for i in 0..cols.len() {
            vals.push(row.get::<_, String>(i + 1)?);
        }
        Ok((locale, vals))
    })?;
    rows.collect()
}

fn lang_of(params: &HashMap<String, String>) -> String {
    params.get("lang").cloned().unwrap_or_else(|| "pl".to_string())
}

fn error_500(e: impl std::fmt::Display) -> Response {
    // The body shape does not matter to the contract (a 500 fails conformance regardless); what
    // matters is not leaking internals the way DEBUG pages do.
    eprintln!("error: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"detail": "Internal server error."})))
        .into_response()
}

fn not_found(what: &str) -> Response {
    // DRF's own 404 wording, verbatim — it is part of the recorded contract.
    (
        StatusCode::NOT_FOUND,
        Json(json!({"detail": format!("No {what} matches the given query.")})),
    )
        .into_response()
}

fn discipline_json(conn: &Connection, id: i64, slug: &str, published: bool, status: &str, lang: &str) -> rusqlite::Result<Value> {
    let t = translations(conn, "taxonomy_disciplinetranslation", "discipline_id", id, &["name", "description"])?;
    let resolved = resolve(&t, lang);
    Ok(json!({
        "id": id,
        "slug": slug,
        "published": published,
        "status": status,
        "name": resolved.map_or_else(|| slug.to_string(), |v| v[0].clone()),
        "description": resolved.map_or_else(String::new, |v| v[1].clone()),
    }))
}

async fn disciplines_list(State(app): Ctx, Query(q): Query<HashMap<String, String>>) -> Response {
    let lang = lang_of(&q);
    let run = || -> rusqlite::Result<Value> {
        let conn = open(&app)?;
        // No Meta ordering on Discipline — Django emits table order, which is rowid order.
        let mut stmt = conn.prepare(
            "SELECT id, slug, published, status FROM taxonomy_discipline WHERE published = 1 ORDER BY id",
        )?;
        let rows: Vec<(i64, String, bool, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<_, _>>()?;
        let mut out = Vec::with_capacity(rows.len());
        for (id, slug, published, status) in rows {
            out.push(discipline_json(&conn, id, &slug, published, &status, &lang)?);
        }
        Ok(Value::Array(out))
    };
    match run() {
        Ok(v) => Json(v).into_response(),
        Err(e) => error_500(e),
    }
}

fn find_discipline(conn: &Connection, slug: &str) -> rusqlite::Result<Option<(i64, String, bool, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, slug, published, status FROM taxonomy_discipline WHERE published = 1 AND slug = ?1",
    )?;
    let mut rows = stmt.query_map([slug], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    rows.next().transpose()
}

async fn discipline_detail(
    State(app): Ctx,
    Path(slug): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let lang = lang_of(&q);
    let run = || -> rusqlite::Result<Option<Value>> {
        let conn = open(&app)?;
        match find_discipline(&conn, &slug)? {
            None => Ok(None),
            Some((id, slug, published, status)) => {
                Ok(Some(discipline_json(&conn, id, &slug, published, &status, &lang)?))
            }
        }
    };
    match run() {
        Ok(Some(v)) => Json(v).into_response(),
        Ok(None) => not_found("Discipline"),
        Err(e) => error_500(e),
    }
}

async fn discipline_branches(
    State(app): Ctx,
    Path(slug): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let lang = lang_of(&q);
    let run = || -> rusqlite::Result<Option<Value>> {
        let conn = open(&app)?;
        let Some((disc_id, disc_slug, _, _)) = find_discipline(&conn, &slug)? else {
            return Ok(None);
        };
        // Branch Meta ordering: ['order', 'slug'].
        let mut stmt = conn.prepare(
            "SELECT id, slug, published, status, \"order\" FROM taxonomy_branch \
             WHERE published = 1 AND discipline_id = ?1 ORDER BY \"order\", slug",
        )?;
        let branches: Vec<(i64, String, bool, String, i64)> = stmt
            .query_map([disc_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })?
            .collect::<Result<_, _>>()?;

        let mut out = Vec::with_capacity(branches.len());
        for (bid, bslug, bpub, bstatus, border) in branches {
            let bt = translations(&conn, "taxonomy_branchtranslation", "branch_id", bid, &["name", "description"])?;
            let bres = resolve(&bt, &lang);

            // Topic Meta ordering: ['branch', 'order'] — id as the tiebreak SQLite already implies.
            let mut tstmt = conn.prepare(
                "SELECT id, slug, \"order\", status FROM taxonomy_topic \
                 WHERE branch_id = ?1 ORDER BY branch_id, \"order\", id",
            )?;
            let topics: Vec<(i64, String, i64, String)> = tstmt
                .query_map([bid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
                .collect::<Result<_, _>>()?;
            let mut topics_json = Vec::with_capacity(topics.len());
            for (tid, tslug, torder, tstatus) in topics {
                let tt = translations(&conn, "taxonomy_topictranslation", "topic_id", tid, &["name"])?;
                let tres = resolve(&tt, &lang);
                topics_json.push(json!({
                    "id": tid,
                    "slug": tslug,
                    "branch": bid,
                    "order": torder,
                    "status": tstatus,
                    "name": tres.map_or_else(|| tslug.clone(), |v| v[0].clone()),
                }));
            }

            // Chapter Meta ordering: ['branch', 'number']; its topics M2M resolves through the
            // Topic queryset, so Topic's own Meta ordering applies to the id list too.
            let mut cstmt = conn.prepare(
                "SELECT id, number, start_page FROM taxonomy_chapter \
                 WHERE branch_id = ?1 ORDER BY branch_id, number",
            )?;
            let chapters: Vec<(i64, i64, Option<i64>)> = cstmt
                .query_map([bid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect::<Result<_, _>>()?;
            let mut chapters_json = Vec::with_capacity(chapters.len());
            for (cid, cnumber, cstart) in chapters {
                let mut mstmt = conn.prepare(
                    "SELECT jt.topic_id FROM taxonomy_chapter_topics jt \
                     JOIN taxonomy_topic t ON t.id = jt.topic_id \
                     WHERE jt.chapter_id = ?1 ORDER BY t.branch_id, t.\"order\", t.id",
                )?;
                let topic_ids: Vec<i64> = mstmt
                    .query_map([cid], |r| r.get(0))?
                    .collect::<Result<_, _>>()?;
                let ct = translations(&conn, "taxonomy_chaptertranslation", "chapter_id", cid, &["title"])?;
                let cres = resolve(&ct, &lang);
                chapters_json.push(json!({
                    "id": cid,
                    "branch": bid,
                    "number": cnumber,
                    "start_page": cstart,
                    "topics": topic_ids,
                    "title": cres.map_or_else(|| format!("Chapter {cnumber}"), |v| v[0].clone()),
                }));
            }

            out.push(json!({
                "id": bid,
                "slug": bslug,
                "discipline": disc_slug,
                "published": bpub,
                "status": bstatus,
                "order": border,
                "name": bres.map_or_else(|| bslug.clone(), |v| v[0].clone()),
                "description": bres.map_or_else(String::new, |v| v[1].clone()),
                "topics": topics_json,
                "chapters": chapters_json,
            }));
        }
        Ok(Some(Value::Array(out)))
    };
    match run() {
        Ok(Some(v)) => Json(v).into_response(),
        Ok(None) => not_found("Discipline"),
        Err(e) => error_500(e),
    }
}

#[tokio::main]
async fn main() {
    let db_path =
        std::env::var("EDMAT_DB").unwrap_or_else(|_| "../backend/db.sqlite3".to_string());
    let port = std::env::var("EDMAT_PORT").unwrap_or_else(|_| "8090".to_string());
    let app = Arc::new(App { db_path });

    // Fail at boot, not on the first request, if the database is not there.
    open(&app).expect("cannot open EDMAT_DB read-only — set EDMAT_DB to the reference db.sqlite3");

    let router = Router::new()
        .route("/api/disciplines/", get(disciplines_list))
        .route("/api/disciplines/{slug}/", get(discipline_detail))
        .route("/api/disciplines/{slug}/branches/", get(discipline_branches))
        .with_state(app);

    let addr = format!("127.0.0.1:{port}");
    println!("edmat-api (rust, M0) listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    axum::serve(listener, router).await.expect("serve");
}
