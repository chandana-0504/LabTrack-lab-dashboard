# main.py
# ============================================================
# BioDash - FastAPI Backend (FINAL CLEAN VERSION)
# ============================================================

import os
import json
from datetime import datetime
from fastapi import FastAPI, Request, Body
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

import mysql.connector
from mysql.connector import IntegrityError
from passlib.hash import bcrypt


# ============================================================
# CONFIG
# ============================================================
from dotenv import load_dotenv
load_dotenv()

MYSQL_USER = os.environ["MYSQL_USER"]
MYSQL_PASSWORD = os.environ["MYSQL_PASSWORD"]
MYSQL_DB = os.environ.get("MYSQL_DB", "biodash")
MYSQL_UNIX_SOCKET = os.environ.get("MYSQL_UNIX_SOCKET", "/var/run/mysqld/mysqld.sock")


# ============================================================
# APP INIT
# ============================================================
app = FastAPI()
app.add_middleware(SessionMiddleware, secret_key="biodash-secret")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# ============================================================
# DB CONNECT
# ============================================================
def db_connect():
    try:
        return mysql.connector.connect(
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DB,
            unix_socket=MYSQL_UNIX_SOCKET,
            autocommit=False,
        )
    except:
        return mysql.connector.connect(
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            host="127.0.0.1",
            database=MYSQL_DB,
            autocommit=False,
        )


# ============================================================
# INIT TABLES
# ============================================================
def init_db_tables():
    conn = db_connect()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users(
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(200) UNIQUE,
            password VARCHAR(255)
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS experiments(
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255),
            `desc` TEXT,
            `type` VARCHAR(100),
            organism VARCHAR(100),
            pi VARCHAR(100),
            date VARCHAR(40),
            params TEXT
        );
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS entries(
            id INT AUTO_INCREMENT PRIMARY KEY,
            exp_id INT,
            name VARCHAR(255),
            param VARCHAR(255),
            val DOUBLE,
            time VARCHAR(80),
            INDEX(exp_id)
        );
    """)

    conn.commit()
    conn.close()


@app.on_event("startup")
def startup():
    init_db_tables()


# ============================================================
# HELPERS
# ============================================================
def logged_in(request):
    return bool(request.session.get("user"))


@app.middleware("http")
async def no_cache(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


# ============================================================
# PAGES
# ============================================================
@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    if not logged_in(request):
        return RedirectResponse("/login")
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/register", response_class=HTMLResponse)
def register_page(request: Request):
    return templates.TemplateResponse("register.html", {"request": request})


@app.get("/experiments", response_class=HTMLResponse)
def experiments_page(request: Request):
    if not logged_in(request):
        return RedirectResponse("/login")
    return templates.TemplateResponse("experiments.html", {"request": request})


@app.get("/experiment/{exp_id}", response_class=HTMLResponse)
def experiment_view(request: Request, exp_id: int):
    if not logged_in(request):
        return RedirectResponse("/login")
    return templates.TemplateResponse("experiment_view.html", {"request": request, "exp_id": exp_id})


@app.get("/alerts", response_class=HTMLResponse)
def alerts_page(request: Request):
    if not logged_in(request):
        return RedirectResponse("/login")
    return templates.TemplateResponse("alerts.html", {"request": request})


# ============================================================
# AUTH
# ============================================================
@app.post("/login")
def login(request: Request, data: dict):
    username = data.get("username", "").strip()
    password = data.get("password", "")

    conn = db_connect()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM users WHERE username=%s", (username,))
    user = cur.fetchone()
    conn.close()

    if not user or not bcrypt.verify(password, user["password"]):
        return JSONResponse({"msg": "Invalid credentials"}, 400)

    request.session["user"] = username
    return {"msg": "ok"}


@app.post("/register")
def register(data: dict):
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if len(password) < 8:
        return JSONResponse({"msg": "password must be ≥ 8 chars"}, 400)

    try:
        conn = db_connect()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users(username,password) VALUES(%s,%s)",
            (username, bcrypt.hash(password))
        )
        conn.commit()
        return {"msg": "registered"}
    except IntegrityError:
        return JSONResponse({"msg": "username exists"}, 400)


@app.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"msg": "ok"}


# ============================================================
# EXPERIMENT CRUD
# ============================================================
@app.get("/api/experiments")
def list_experiments():
    conn = db_connect()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM experiments ORDER BY id DESC")
    rows = cur.fetchall()
    conn.close()
    return rows


@app.post("/api/experiments")
def create_experiment(data: dict):
    params_json = json.dumps(data.get("params", []))

    conn = db_connect()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO experiments(name,`desc`,`type`,organism,pi,date,params)
        VALUES (%s,%s,%s,%s,%s,%s,%s)
    """, (
        data.get("name", ""),
        data.get("desc", ""),
        data.get("type", ""),
        data.get("organism", ""),
        data.get("pi", ""),
        data.get("date", datetime.now().strftime("%Y-%m-%d")),
        params_json
    ))

    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"msg": "ok", "id": new_id}


@app.get("/api/experiments/{exp_id}")
def get_experiment(exp_id: int):
    conn = db_connect()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM experiments WHERE id=%s", (exp_id,))
    row = cur.fetchone()
    conn.close()

    if not row:
        return JSONResponse({"msg": "not found"}, 404)
    return row


@app.put("/api/experiments/{exp_id}")
def update_experiment(exp_id: int, data: dict):
    params_json = json.dumps(data.get("params", []))

    conn = db_connect()
    cur = conn.cursor()
    cur.execute("UPDATE experiments SET params=%s WHERE id=%s", (params_json, exp_id))
    conn.commit()
    conn.close()

    return {"msg": "ok"}


@app.delete("/api/experiments/{exp_id}")
def delete_experiment(exp_id: int):
    conn = db_connect()
    cur = conn.cursor()
    cur.execute("DELETE FROM entries WHERE exp_id=%s", (exp_id,))
    cur.execute("DELETE FROM experiments WHERE id=%s", (exp_id,))
    conn.commit()
    conn.close()
    return {"msg": "deleted"}


# ============================================================
# ENTRY CRUD
# ============================================================
@app.get("/api/experiments/{exp_id}/entries")
def get_entries(exp_id: int):
    conn = db_connect()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM entries WHERE exp_id=%s ORDER BY id ASC", (exp_id,))
    rows = cur.fetchall()
    conn.close()
    return rows


@app.delete("/api/experiments/{exp_id}/entries")
def delete_all_entries(exp_id: int):
    conn = db_connect()
    cur = conn.cursor()
    cur.execute("DELETE FROM entries WHERE exp_id=%s", (exp_id,))
    conn.commit()
    conn.close()
    return {"msg": "all deleted"}


@app.post("/api/experiments/{exp_id}/entries/bulk")
def add_entries_bulk(exp_id: int, payload: dict = Body(...)):
    rows = payload.get("rows", [])
    if not isinstance(rows, list):
        return JSONResponse({"msg": "invalid rows"}, 400)

    conn = db_connect()
    cur = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    batch = []
    for r in rows:
        name = r.get("name", "").strip()
        param = r.get("param", "").strip()
        try:
            val = float(r.get("val"))
        except:
            continue
        if name and param:
            batch.append((exp_id, name, param, val, now))

    if batch:
        cur.executemany("""
            INSERT INTO entries(exp_id,name,param,val,time)
            VALUES(%s,%s,%s,%s,%s)
        """, batch)
        conn.commit()

    conn.close()
    return {"msg": "ok", "inserted": len(batch)}


@app.delete("/api/entries/{entry_id}")
def delete_entry(entry_id: int):
    conn = db_connect()
    cur = conn.cursor()
    cur.execute("DELETE FROM entries WHERE id=%s", (entry_id,))
    conn.commit()
    conn.close()
    return {"msg": "deleted"}


# ============================================================
# LIVE ALERT SYSTEM (NO DATABASE STORAGE)
# ============================================================
def compute_live_alerts():
    conn = db_connect()
    cur = conn.cursor(dictionary=True)

    # Load all experiments
    cur.execute("SELECT * FROM experiments")
    experiments = cur.fetchall()

    alerts = []

    for exp in experiments:
        exp_id = exp["id"]

        # Parse params with thresholds
        try:
            params = json.loads(exp["params"] or "[]")
        except:
            params = []

        critical = {
            p["name"]: p["threshold"]
            for p in params
            if isinstance(p, dict) and p.get("threshold") not in (None, "")
        }

        if not critical:
            continue

        # Load entries
        cur.execute("SELECT * FROM entries WHERE exp_id=%s", (exp_id,))
        entries = cur.fetchall()

        for e in entries:
            pname = e["param"]
            if pname not in critical:
                continue

            thr = critical[pname]
            try:
                val = float(e["val"])
            except:
                continue

            if val > thr:
                alerts.append({
                    "experiment": exp["name"],
                    "message": f"{pname} crossed threshold: {val} > {thr}",
                    "row": {
                        "sample": e["name"],
                        "param": e["param"],
                        "value": e["val"],
                        "entry_time": e["time"]
                    },
                    "time": e["time"]
                })

    conn.close()
    return alerts


@app.get("/api/live-alerts")
def get_live_alerts():
    alerts = compute_live_alerts()
    return JSONResponse(alerts)
