import {
    Activity,
    Bell,
    Globe2,
    Network,
    ShieldCheck,
    Shield,
    ArrowRight
} from "lucide-react";
import "./features.css";
import Link from "next/link";

export default function FeaturesPage() {

    return (
        <main className="features-page">

            {/* HERO */}

            <section className="features-hero">

                <div className="features-badge">
                    <Shield size={14} />
                    Platform Features
                </div>

                <h1>
                    Everything you need to
                    <span> monitor your infrastructure.</span>
                </h1>

                <p>
                    Monitor websites, domains, certificates and services
                    from a single platform. SentinelGrid helps you detect
                    problems before they become incidents.
                </p>

            </section>


            {/* FEATURES */}

            <section className="features-container">

                <div className="features-grid">

                    {/* DOMAIN */}

                    <div className="feature-card feature-card-large">

                        <div className="feature-text">

                            <div className="feature-icon">
                                <Globe2 size={21} />
                            </div>

                            <span className="feature-label">
                                DOMAIN MONITORING
                            </span>

                            <h2>
                                Monitor every domain in one place.
                            </h2>

                            <p>
                                Keep track of your domains, availability,
                                DNS configuration and critical changes
                                without manually checking every service.
                            </p>

                        </div>


                        <div className="domain-preview">

                            <div className="domain-preview-item">

                                <div className="domain-preview-icon">
                                    <Globe2 size={17} />
                                </div>

                                <div className="domain-preview-info">
                                    <strong>sentinelgrid.com</strong>
                                    <span>Operational</span>
                                </div>

                                <span className="status-dot online" />

                            </div>


                            <div className="domain-preview-item">

                                <div className="domain-preview-icon">
                                    <Globe2 size={17} />
                                </div>

                                <div className="domain-preview-info">
                                    <strong>api.example.com</strong>
                                    <span>Operational</span>
                                </div>

                                <span className="status-dot online" />

                            </div>


                            <div className="domain-preview-item">

                                <div className="domain-preview-icon">
                                    <Globe2 size={17} />
                                </div>

                                <div className="domain-preview-info">
                                    <strong>service.example.com</strong>
                                    <span>Unavailable</span>
                                </div>

                                <span className="status-dot offline" />

                            </div>

                        </div>

                    </div>


                    {/* UPTIME */}

                    <div className="feature-card">

                        <div className="feature-icon">
                            <Activity size={21} />
                        </div>

                        <span className="feature-label">
                            UPTIME
                        </span>

                        <h3>
                            Real-time uptime monitoring.
                        </h3>

                        <p>
                            Monitor your websites and services and quickly
                            detect unexpected downtime.
                        </p>

                    </div>


                    {/* SSL */}

                    <div className="feature-card">

                        <div className="feature-icon">
                            <ShieldCheck size={21} />
                        </div>

                        <span className="feature-label">
                            SSL CERTIFICATES
                        </span>

                        <h3>
                            Never miss an SSL expiration.
                        </h3>

                        <p>
                            Track certificate expiration dates and receive
                            warnings before certificates become invalid.
                        </p>

                    </div>


                    {/* DNS */}

                    <div className="feature-card">

                        <div className="feature-icon">
                            <Network size={21} />
                        </div>

                        <span className="feature-label">
                            DNS MONITORING
                        </span>

                        <h3>
                            Keep your DNS under control.
                        </h3>

                        <p>
                            Monitor important DNS records and detect
                            configuration issues or unexpected changes.
                        </p>

                    </div>


                    {/* SECURITY */}

                    <div className="feature-card">

                        <div className="feature-icon">
                            <Shield size={21} />
                        </div>

                        <span className="feature-label">
                            SECURITY
                        </span>

                        <h3>
                            Automatic security checks.
                        </h3>

                        <p>
                            Identify common security risks and configuration
                            problems across your monitored infrastructure.
                        </p>

                    </div>


                    {/* ALERTS */}

                    <div className="feature-card feature-card-large">

                        <div className="feature-text">

                            <div className="feature-icon">
                                <Bell size={21} />
                            </div>

                            <span className="feature-label">
                                ALERTS
                            </span>

                            <h2>
                                Know when something goes wrong.
                            </h2>

                            <p>
                                SentinelGrid automatically identifies
                                incidents and keeps you informed when
                                infrastructure requires attention.
                            </p>

                        </div>


                        <div className="alerts-preview">

                            <div className="alert-preview-item">

                                <div className="alert-icon warning">
                                    <ShieldCheck size={17} />
                                </div>

                                <div>
                                    <strong>SSL Certificate</strong>
                                    <span>Expires in 5 days</span>
                                </div>

                                <small>2m ago</small>

                            </div>


                            <div className="alert-preview-item">

                                <div className="alert-icon danger">
                                    <Activity size={17} />
                                </div>

                                <div>
                                    <strong>api.example.com</strong>
                                    <span>Service unavailable</span>
                                </div>

                                <small>8m ago</small>

                            </div>

                        </div>

                    </div>

                </div>

            </section>


            {/* CTA */}

            <section className="features-cta">

                <div>

                    <span>START MONITORING</span>

                    <h2>
                        Your infrastructure. One dashboard.
                    </h2>

                    <p>
                        Start monitoring your infrastructure with SentinelGrid.
                    </p>

                </div>

                <Link href="/auth/sign-up">
                    Get started
                    <ArrowRight size={17} />
                </Link>

            </section>

        </main>
    );
}