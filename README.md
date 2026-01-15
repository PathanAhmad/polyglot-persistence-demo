# IMSE MS2 - Food Delivery System

We built a small food delivery demo that works in **two modes**:

- **SQL mode** (MariaDB): normal relational tables + joins
- **Mongo mode** (MongoDB): documents optimized for our specific API use-cases

---

## Startup instructions

### Prerequisites
- Docker + Docker Compose

### What starts up
When we run Docker Compose, we start 4 containers:
- **MariaDB** (SQL)
- **MongoDB** (NoSQL)
- **Backend** (Node.js + Express) on port **3000**
- **Frontend** (React + Vite) on port **5173**

After it's running:
- **Frontend:** `http://localhost:5173`
- **Backend API:** `http://localhost:3000/api`

### First-time demo setup (from the UI)
In the frontend, open the **Admin** tab.

**Admin demo login (frontend-only):**
- **Access code:** `imse-ms2`

Then run:
- **Check Health** (pings MariaDB + ensures Mongo indexes exist)
- **Import & Reset Data** (creates schema + inserts demo data)
- **Migrate to MongoDB** (copies the SQL snapshot into MongoDB)

---

## How to run (Docker commands)

### Start everything

```bash
docker compose up --build
```

### Stop everything

```bash
docker compose down
```

### Full reset (delete DB volumes)
Use this if you want a clean database state.

```bash
docker compose down -v
```

### Common checks

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
```

---

## Architecture overview

### High-level flow
- The **frontend** calls the **backend** at `/api/...`.
- The backend talks to **MariaDB** for SQL mode endpoints.
- For Mongo mode endpoints, the backend talks to **MongoDB**.
- The **migration** endpoint reads a full snapshot from MariaDB and writes it into MongoDB (we don't "dual write").

### Repo layout (main folders)
- `frontend/`: React UI (Vite dev server in Docker)
- `backend/`: Express API + DB adapters
- `db/mariadb/schema.sql`: SQL schema used by the import/reset step
- `docker-compose.yml`: wires all services together
