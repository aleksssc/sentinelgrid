import Link from "next/link";
import "./about.css";
import {
  Activity,
  Eye,
  Layers3,
  ShieldCheck,
  ArrowRight,
  Radar,
} from "lucide-react";

export default function AboutPage() {
  return (
    <main className="about-page">

      {/* =========================================================
                            BACKGROUND
      ========================================================== */}

      <div className="about-background">

        <div className="about-background-grid" />

        <div className="about-glow about-glow-one" />
        <div className="about-glow about-glow-two" />

      </div>


      {/* =========================================================
                              HERO
      ========================================================== */}

      <section className="about-hero">

        <div className="about-badge">
          <Radar size={15} />
          About SentinelGrid
        </div>

        <h1>
          Infrastructure monitoring
          <span>without the complexity.</span>
        </h1>

        <p>
          SentinelGrid is built to make infrastructure monitoring simple,
          clear and accessible from one unified platform.
        </p>

      </section>


      {/* =========================================================
                          WHY SENTINELGRID
      ========================================================== */}

      <section className="about-container">

        <div className="about-story">

          <div className="about-story-content">

            <span className="about-label">
              WHY SENTINELGRID
            </span>

            <h2>
              Monitoring should give you answers,
              not more complexity.
            </h2>

            <p>
              Infrastructure is increasingly distributed across websites,
              APIs, servers, domains, DNS providers and cloud services.
            </p>

            <p>
              SentinelGrid brings those signals together so you can understand
              the health of your infrastructure without switching between
              multiple disconnected tools.
            </p>

          </div>


          {/* PREVIEW */}

          <div className="about-monitor-preview">

            <div className="about-preview-header">

              <div>
                <span>Infrastructure overview</span>

                <strong>
                  All systems operational
                </strong>
              </div>

              <span className="about-online-dot" />

            </div>


            <div className="about-preview-item">

              <div className="about-preview-icon">
                <Activity size={17} />
              </div>

              <div className="about-preview-info">
                <strong>Website Monitoring</strong>
                <span>12 monitors operational</span>
              </div>

              <span className="about-status">
                Healthy
              </span>

            </div>


            <div className="about-preview-item">

              <div className="about-preview-icon">
                <ShieldCheck size={17} />
              </div>

              <div className="about-preview-info">
                <strong>SSL Certificates</strong>
                <span>No certificates expiring</span>
              </div>

              <span className="about-status">
                Secure
              </span>

            </div>


            <div className="about-preview-item">

              <div className="about-preview-icon">
                <Layers3 size={17} />
              </div>

              <div className="about-preview-info">
                <strong>Infrastructure</strong>
                <span>24 services monitored</span>
              </div>

              <span className="about-status">
                Online
              </span>

            </div>

          </div>

        </div>


        {/* =========================================================
                              APPROACH
        ========================================================== */}

        <div className="about-section-header">

          <span className="about-label">
            OUR APPROACH
          </span>

          <h2>
            Built around three simple principles.
          </h2>

          <p>
            SentinelGrid focuses on visibility, simplicity and security
            across every part of the platform.
          </p>

        </div>


        <div className="about-principles">

          <AboutCard
            icon={<Eye size={21} />}
            title="Clear visibility"
            description="See the health of your infrastructure from one place without digging through multiple monitoring tools."
          />

          <AboutCard
            icon={<Layers3 size={21} />}
            title="Simple by default"
            description="Powerful monitoring should remain easy to configure, understand and operate."
          />

          <AboutCard
            icon={<ShieldCheck size={21} />}
            title="Secure by design"
            description="Authentication, data isolation and infrastructure access are considered from the beginning."
          />

        </div>

      </section>


      {/* =========================================================
                              GOAL
      ========================================================== */}

      <section className="about-direction">

        <div>

          <span className="about-label">
            OUR GOAL
          </span>

          <h2>
            One place to understand what is happening.
          </h2>

        </div>


        <div className="about-direction-text">

          <p>
            SentinelGrid is being built as a unified infrastructure
            monitoring platform for developers, system administrators
            and teams managing online services.
          </p>

          <p>
            The goal is simple: detect problems earlier, reduce manual
            checks and make infrastructure health immediately understandable.
          </p>

        </div>

      </section>


      {/* =========================================================
                              CTA
      ========================================================== */}

      <section className="about-cta">

        <div>

          <span>
            START MONITORING
          </span>

          <h2>
            See your infrastructure clearly.
          </h2>

          <p>
            Bring your domains, services and infrastructure into SentinelGrid.
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


function AboutCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className="about-card">

      <div className="about-card-icon">
        {icon}
      </div>

      <h3>
        {title}
      </h3>

      <p>
        {description}
      </p>

    </article>
  );
}