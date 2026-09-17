import Link from "next/link";
import { PLANS, formatPlanPrice, planMarketingFeatures, SALES_URL } from "@/lib/plans";
import "./pricing.css";
import {
  Check,
  ArrowRight,
  Shield,
  Zap,
  Building2,
  BadgeEuro,
} from "lucide-react";

const plans = (["free", "pro", "business"] as const).map((slug) => ({
  ...PLANS[slug], price: formatPlanPrice(slug), period: "/month", icon: slug === "free" ? Shield : slug === "pro" ? Zap : Building2, featured: slug === "pro", button: slug === "free" ? "Get started" : `Start with ${PLANS[slug].name}`, features: planMarketingFeatures(slug),
}));

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
          clients and team capacity.
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
      <h3>{PLANS.enterprise.name}</h3>

      <p>
        {PLANS.enterprise.description}
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
        Custom licensed team members
      </div>

      <div>
        <Check size={15} />
        Custom infrastructure limits
      </div>

      <div>
        <Check size={15} />
        Custom licensed device capacity
      </div>

      <div>
        <Check size={15} />
        Custom licensed monitor capacity
      </div>

    </div>

  </div>


  <div className="enterprise-cta">

    <span className="enterprise-custom">
      {formatPlanPrice("enterprise")}
    </span>

    <Link
      href={SALES_URL}
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

        <Link href={SALES_URL}>
          Contact us
          <ArrowRight size={16} />
        </Link>

      </section>

    </main>
  );
}