<div align="center">

# 🛡️ SentinelGrid

### Monitor. Detect. Protect.

**SentinelGrid is a modern cybersecurity monitoring and attack-surface management platform built to give organizations a clear view of their external security posture.**

<br>

![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge\&logo=nextdotjs\&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge\&logo=typescript\&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge\&logo=tailwindcss\&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge\&logo=supabase\&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge\&logo=postgresql\&logoColor=white)

</div>

---

## ⚡ Overview

SentinelGrid is a SaaS cybersecurity platform designed to help teams **monitor internet-facing assets, identify security issues and react to changes before they become incidents**.

The project is being built with a simple objective:

> **Turn complex security data into clear, actionable information.**

The initial MVP focuses on website and endpoint monitoring while providing the foundation for a much larger security monitoring platform.

---

## ✨ Core Features

### 🌐 Monitoring

Create and manage monitors for websites and internet-facing services.

* HTTP/HTTPS availability monitoring
* Response status tracking
* Monitor health overview
* Historical checks
* Centralized monitoring dashboard

### 🏢 Organizations

SentinelGrid uses an organization-based architecture designed for teams and companies.

* Multiple organizations
* Organization owners
* Members and roles
* Organization settings
* Member management
* Secure invitation system

Users join organizations through invitations instead of directly joining them.

### 👥 Role-Based Access

Organization permissions are structured around different roles:

| Role       | Access                                |
| ---------- | ------------------------------------- |
| **Owner**  | Full organization control             |
| **Admin**  | Manage organization resources         |
| **Member** | Access assigned organization features |

### 🔐 Authentication

Authentication and account management powered by Supabase.

* Sign up
* Login
* Email confirmation
* Password recovery
* Password update
* Protected dashboard routes

---

## 📊 Dashboard

The SentinelGrid dashboard provides a central view of the organization's monitoring environment.

The goal is to provide a clean operational interface inspired by modern observability platforms while keeping security information easy to understand.

```text
Dashboard
│
├── Overview
│
├── Monitors
│   ├── Monitor List
│   └── Monitor Details
│
├── Organizations
│   ├── Organization List
│   ├── Members
│   ├── Invitations
│   └── Settings
│
├── Alerts
│
├── Profile
│
└── Settings
```

---

## 🧱 Tech Stack

### Frontend

* **Next.js**
* **React**
* **TypeScript**
* **Tailwind CSS**

### Backend

* **Supabase**
* **PostgreSQL**
* **Supabase Authentication**
* **Supabase API**

### Infrastructure

* **Vercel**
* **Supabase Cloud**

---

## 🗄️ Architecture

```text
                  ┌─────────────────┐
                  │      User       │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │     Next.js     │
                  │   Application   │
                  └────────┬────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
     ┌─────────────────┐       ┌─────────────────┐
     │    Supabase     │       │ Monitoring Core │
     │ Authentication  │       │                 │
     └────────┬────────┘       └────────┬────────┘
              │                         │
              └────────────┬────────────┘
                           ▼
                  ┌─────────────────┐
                  │   PostgreSQL    │
                  │    Database     │
                  └─────────────────┘
```

---

## 🛡️ Security Model

SentinelGrid is designed around **organization isolation**.

Each organization has its own:

* Members
* Roles
* Monitors
* Settings
* Invitations
* Security data

Access to organization resources is validated using membership relationships and role permissions.

```text
User
 │
 ▼
Organization Member
 │
 ├── Owner
 ├── Admin
 └── Member
 │
 ▼
Organization Resources
```

---

## 🧪 Current MVP

The current development phase focuses on building the core platform foundation.

### Implemented / In Development

* [x] Authentication
* [x] User accounts
* [x] Dashboard structure
* [x] Organization creation
* [x] Organization management
* [x] Organization roles
* [x] Organization settings
* [x] Organization invitations
* [x] Member management
* [x] Monitor management
* [ ] Notification center
* [ ] Advanced alerts
* [ ] Monitoring history improvements
* [ ] Security analytics

---

## 🗺️ Roadmap

SentinelGrid is designed to grow beyond basic uptime monitoring.

### Phase 1 — Monitoring

* HTTP/HTTPS monitoring
* Availability tracking
* Response history
* Organization management
* Alerts
* Notifications

### Phase 2 — Asset Discovery

* Domain discovery
* Subdomain discovery
* IP discovery
* Port scanning
* Service identification
* DNS monitoring
* TLS certificate monitoring

### Phase 3 — Security Intelligence

* Vulnerability detection
* CVE correlation
* Misconfiguration detection
* Exposed services
* Security findings
* Risk scoring
* Asset criticality

### Phase 4 — Attack Surface Management

* External attack surface mapping
* Asset relationship visualization
* Attack paths
* Security posture scoring
* Prioritized remediation
* Historical security posture

### Phase 5 — Platform

* Custom dashboards
* Integrations
* Webhooks
* API access
* Agents
* Advanced alerting
* Reports
* Subscription plans

---

## 🚀 Getting Started

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/sentinelgrid.git
```

Enter the project:

```bash
cd sentinelgrid
```

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env.local
```

Configure the required Supabase environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```
---

## 🎯 Vision

SentinelGrid aims to become a single interface where organizations can understand:

**What is exposed?**

**What is vulnerable?**

**What changed?**

**What should be fixed first?**

Instead of forcing teams to analyze information across multiple disconnected security tools, SentinelGrid aims to bring monitoring, visibility and security intelligence into one platform.

---

<div align="center">

### 🛡️ SentinelGrid

**Visibility is the first layer of security.**

Built for modern infrastructure.

</div>
