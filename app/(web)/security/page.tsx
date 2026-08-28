import Link from "next/link";
import "./security.css";
import {
  ShieldCheck,
  LockKeyhole,
  Database,
  KeyRound,
  Eye,
  ServerCog,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

export default function SecurityPage() {
  return (
    <main className="security-page">

      {/* =========================================================
                          BACKGROUND
      ========================================================== */}

      <div className="security-background">
        <div className="security-grid" />

        <div className="security-glow security-glow-one" />
        <div className="security-glow security-glow-two" />
      </div>


      {/* =========================================================
                              HERO
      ========================================================== */}

      <section className="security-hero">

        <div className="security-badge">
          <ShieldCheck size={15} />
          Security by design
        </div>

        <h1>
          Your infrastructure data
          <span> stays protected.</span>
        </h1>

        <p>
          SentinelGrid is built with security in mind from authentication
          to infrastructure monitoring and data isolation.
        </p>

      </section>


      {/* =========================================================
                      SECURITY OVERVIEW
      ========================================================== */}

      <section className="security-container">

        <div className="security-main-card">

          <div className="security-main-content">

            <div className="security-icon">
              <ShieldCheck size={24} />
            </div>

            <span className="security-label">
              PLATFORM SECURITY
            </span>

            <h2>
              Security is part of the platform,
              not an afterthought.
            </h2>

            <p>
              SentinelGrid is designed to minimize unnecessary access,
              isolate user data and securely manage authentication
              across the platform.
            </p>

          </div>


          <div className="security-status-panel">

            <div className="security-status-header">

              <div>
                <span>Security Status</span>
                <strong>All systems protected</strong>
              </div>

              <div className="security-status-dot" />

            </div>


            <div className="security-status-item">
              <CheckCircle2 size={16} />
              Authentication active
            </div>

            <div className="security-status-item">
              <CheckCircle2 size={16} />
              Encrypted connections
            </div>

            <div className="security-status-item">
              <CheckCircle2 size={16} />
              User data isolation
            </div>

            <div className="security-status-item">
              <CheckCircle2 size={16} />
              Protected monitoring services
            </div>

          </div>

        </div>


        {/* =========================================================
                          SECURITY CARDS
        ========================================================== */}

        <div className="security-grid-cards">

          <SecurityCard
            icon={<LockKeyhole size={21} />}
            label="ENCRYPTION"
            title="Encrypted by default."
            description="Connections between users, the platform and monitored services are protected using secure encrypted communication."
          />

          <SecurityCard
            icon={<KeyRound size={21} />}
            label="AUTHENTICATION"
            title="Secure authentication."
            description="User sessions and authentication are handled securely with modern identity and session management."
          />

          <SecurityCard
            icon={<Database size={21} />}
            label="DATA"
            title="Isolated user data."
            description="Infrastructure information is scoped to the authenticated user and protected from unauthorized access."
          />

          <SecurityCard
            icon={<Eye size={21} />}
            label="VISIBILITY"
            title="Only the data you need."
            description="SentinelGrid is designed to collect only the information necessary to monitor your infrastructure."
          />

          <SecurityCard
            icon={<ServerCog size={21} />}
            label="INFRASTRUCTURE"
            title="Protected monitoring services."
            description="Monitoring processes are separated from the public website and protected behind authenticated services."
          />

          <SecurityCard
            icon={<ShieldCheck size={21} />}
            label="SECURITY CHECKS"
            title="Monitor configuration risks."
            description="Detect SSL issues, DNS problems and infrastructure configuration changes before they become incidents."
          />

        </div>

      </section>


      {/* =========================================================
                      SECURITY PRINCIPLES
      ========================================================== */}

      <section className="security-principles">

        <div className="security-principles-header">

          <span>
            SECURITY PRINCIPLES
          </span>

          <h2>
            Built around least privilege.
          </h2>

          <p>
            SentinelGrid follows a simple principle: users and services
            should only access what they actually need.
          </p>

        </div>


        <div className="security-principles-list">

          <SecurityPrinciple
            number="01"
            title="Authentication first"
            description="Protected areas require a valid authenticated session before infrastructure data can be accessed."
          />

          <SecurityPrinciple
            number="02"
            title="Data isolation"
            description="Monitoring data is associated with its owner and separated from other SentinelGrid accounts."
          />

          <SecurityPrinciple
            number="03"
            title="Minimum exposure"
            description="Sensitive infrastructure operations are kept outside the public-facing application."
          />

          <SecurityPrinciple
            number="04"
            title="Continuous improvement"
            description="Security controls evolve alongside the platform as new monitoring capabilities are introduced."
          />

        </div>

      </section>


      {/* =========================================================
                              CTA
      ========================================================== */}

      <section className="security-cta">

        <div>

          <span>
            MONITOR WITH CONFIDENCE
          </span>

          <h2>
            Keep visibility without sacrificing security.
          </h2>

          <p>
            Start monitoring your infrastructure with SentinelGrid.
          </p>

        </div>


        <Link href="/auth/sign-up">
          Get started
          <ArrowRight size={16} />
        </Link>

      </section>

    </main>
  );
}



/* =========================================================
                        SECURITY CARD
========================================================= */

function SecurityCard({
  icon,
  label,
  title,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  description: string;
}) {
  return (
    <article className="security-card">

      <div className="security-icon">
        {icon}
      </div>

      <span className="security-label">
        {label}
      </span>

      <h3>
        {title}
      </h3>

      <p>
        {description}
      </p>

    </article>
  );
}



/* =========================================================
                      SECURITY PRINCIPLE
========================================================= */

function SecurityPrinciple({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="security-principle">

      <span className="security-principle-number">
        {number}
      </span>

      <div>

        <h3>
          {title}
        </h3>

        <p>
          {description}
        </p>

      </div>

    </div>
  );
}