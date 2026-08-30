import Link from "next/link";
import "./pricing.css";
import {
  Check,
  ArrowRight,
  Shield,
  Zap,
  Building2,
  BadgeEuro,
} from "lucide-react";

const plans = [
  {
    name: "Free",
    description: "For personal projects and small environments.",
    price: "€0",
    period: "/month",
    icon: Shield,
    featured: false,
    button: "Get started",
    features: [
      "1 Organization",
      "1 Team member",
      "Up to 3 Clients",
      "10 Devices",
      "10 Monitors",
      "5 Minute monitoring checks",
      "Website, SSL and DNS monitoring",
      "Email alerts",
      "7 Days history",
    ],
  },
  {
    name: "Pro",
    description: "For professionals and growing infrastructure.",
    price: "€19,99",
    period: "/month",
    icon: Zap,
    featured: true,
    button: "Start with Pro",
    features: [
      "1 Organization",
      "Up to 5 Team members",
      "Up to 25 Clients",
      "100 Devices",
      "100 Monitors",
      "1 Minute monitoring checks",
      "Website, API, SSL and DNS monitoring",
      "Advanced alerts and webhooks",
      "SentinelGrid Agent",
      "90 Days history",
    ],
  },
  {
    name: "Business",
    description: "For IT teams and managed infrastructure.",
    price: "€49,99",
    period: "/month",
    icon: Building2,
    featured: false,
    button: "Get Business",
    features: [
      "1 Organization",
      "Up to 20 Team members",
      "Unlimited Clients and Sites",
      "500 Devices",
      "500 Monitors",
      "30 Second monitoring checks",
      "Advanced monitoring and alerting",
      "Roles and permissions",
      "Audit logs and reports",
      "SentinelGrid Agent & Remote actions",
      "1 Year history",
      "Priority support",
    ],
  },
];

const enterprisePlan = {
  name: "Enterprise",
  description:
    "Custom infrastructure monitoring for large teams and organizations.",
  price: "Custom",
  icon: Building2,
  button: "Contact Sales",
  features: [
    "Unlimited Team members",
    "Unlimited Clients and Sites",
    "Custom Device limits",
    "Custom Monitor limits",
    "Custom Data retention",
    "Advanced Roles and permissions",
    "SSO / SAML authentication",
    "Custom integrations",
    "SLA and Priority support",
  ],
};

export default function PricingPage() {
  return (
    <main className="pricing-page">

      {/* BACKGROUND */}

      <div className="pricing-background">
        <div className="pricing-glow pricing-glow-left" />
        <div className="pricing-glow pricing-glow-right" />
      </div>


      {/* HERO */}

      <section className="pricing-hero">

        <div className="pricing-badge">
            <BadgeEuro size={15} />
            Simple pricing
        </div>

        <h1>
          Monitoring that scales
          <span> with your infrastructure.</span>
        </h1>

        <p>
          Start for free and upgrade when you need more monitors,
          faster checks and advanced infrastructure insights.
        </p>

      </section>


{/* PLANS */}

<section className="pricing-container">

  <div className="pricing-grid">

    {plans.map((plan) => {
      const Icon = plan.icon;

      return (
        <article
          key={plan.name}
          className={`pricing-card ${
            plan.featured ? "pricing-card-featured" : ""
          }`}
        >

          {plan.featured && (
            <div className="pricing-popular">
              Most popular
            </div>
          )}

          <div className="pricing-plan-icon">
            <Icon size={20} />
          </div>

          <div className="pricing-plan-header">

            <h2>{plan.name}</h2>

            <p>
              {plan.description}
            </p>

          </div>

          <div className="pricing-price">

            <strong>
              {plan.price}
            </strong>

            <span>
              {plan.period}
            </span>

          </div>

          <Link
            href="/auth/sign-up"
            className={
              plan.featured
                ? "pricing-button pricing-button-primary"
                : "pricing-button"
            }
          >
            {plan.button}

            <ArrowRight size={16} />
          </Link>

          <div className="pricing-divider" />

          <div className="pricing-features">

            <span className="pricing-includes">
              Includes
            </span>

            {plan.features.map((feature) => (
              <div
                key={feature}
                className="pricing-feature"
              >
                <Check size={15} />

                <span>
                  {feature}
                </span>
              </div>
            ))}

          </div>

        </article>
      );
    })}

  </div>


  {/* ENTERPRISE */}
{/* ENTERPRISE */}

<div className="enterprise-card">

  <div className="enterprise-info">

    <div className="pricing-plan-icon">
      <Building2 size={20} />
    </div>

    <div>
      <h3>Enterprise</h3>

      <p>
        For large teams and complex infrastructure.
      </p>
    </div>

  </div>


  <div className="enterprise-extra">

    <span className="enterprise-label">
      Everything in Business, plus
    </span>

    <div className="enterprise-list">

      <div>
        <Check size={15} />
        Unlimited Team members
      </div>

      <div>
        <Check size={15} />
        Custom infrastructure limits
      </div>

      <div>
        <Check size={15} />
        SSO / SAML authentication
      </div>

      <div>
        <Check size={15} />
        Custom integrations & SLA
      </div>

    </div>

  </div>


  <div className="enterprise-cta">

    <span className="enterprise-custom">
      Custom
    </span>

    <Link
      href="/contact"
      className="enterprise-button"
    >
      Contact Sales

      <ArrowRight size={16} />
    </Link>

  </div>

</div>

</section>


      {/* BOTTOM CTA */}

      <section className="pricing-bottom">

        <div>
          <span>NEED MORE?</span>

          <h2>
            Built for infrastructure of any size.
          </h2>

          <p>
            Need custom limits, larger environments or specific
            monitoring requirements?
          </p>
        </div>

        <Link href="/contact">
          Contact us
          <ArrowRight size={16} />
        </Link>

      </section>

    </main>
  );
}