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
      "5 monitors",
      "5 minute checks",
      "Uptime monitoring",
      "SSL certificate monitoring",
      "DNS checks",
      "7 days history",
    ],
  },
  {
    name: "Pro",
    description: "For developers and growing infrastructure.",
    price: "€9",
    period: "/month",
    icon: Zap,
    featured: true,
    button: "Start with Pro",
    features: [
      "50 monitors",
      "1 minute checks",
      "Uptime monitoring",
      "SSL certificate monitoring",
      "DNS monitoring",
      "Security checks",
      "Email alerts",
      "90 days history",
    ],
  },
  {
    name: "Business",
    description: "For teams managing critical infrastructure.",
    price: "€29",
    period: "/month",
    icon: Building2,
    featured: false,
    button: "Get Business",
    features: [
      "250 monitors",
      "30 second checks",
      "Advanced security checks",
      "Priority alerts",
      "Multiple team members",
      "Reports",
      "1 year history",
      "Priority support",
    ],
  },
];

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