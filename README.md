# Overview

I decided to set up a multi-application container environment using Traefik as a reverse proxy in order to have some alternative to AWS.
I encountered several challenges along the way and this document chronicles my process: from initial configuration attempts to the final working solution.

## Initial Setup: The Applications

I began with two distinct applications that needed to coexist and be easily accessible:

**NASA Space Exploration App - A Node.js/Express backend with React frontend and MongoDB database**
**Property Management System - A Go backend with Next.js frontend and PostgreSQL database**

My goal was to use Traefik as a reverse proxy to route traffic to these applications based on domain names:

[nasa.localhost](https://majortomtogroundcontrol.duckdns.org/) → A simple Space App that uses some outdated SpaceX Api from github.
[property.localhost](https://propertyapp.duckdns.org/) → A Property Management App that tracks the financial reserve for property repairs.

### Challenge 1: Choosing the Right Reverse Proxy
Initially, I attempted to use Envoy Proxy for this task. While Envoy offers powerful features for microservice architectures, I quickly discovered that I can't deal with verbose YAML configuration and lack of automatic service discovery made so soon after setting up my property app infrastructure - https://github.com/TankEngine-ish/property_management_system_infrastructure

After careful consideration, we pivoted to Traefik, which offers:

Automatic service discovery through Docker labels and built-in dashboard for monitoring and troubleshooting.
Look at how nice and clean it is: 
![alt text](<assets/Screenshot from 2025-03-31 16-31-27.png>)


### Challenge 2: Hardcoded API URL in the Next.js Application
Perhaps the most annoying issue was the discovery that API requests from the Property Management frontend were consistently attempting to reach the stupidly hardcoded AWS IP address.
This reminded me that when Next.js applications have environment variables with the NEXT_PUBLIC_ prefix are embedded in the JavaScript bundle at build time, not injected at runtime. This also happened while I was setting up my Helm charts. Despite commenting out this line and providing a new environment variable in docker-compose.yml, the hardcoded value persisted because it was already compiled into the JavaScript bundle.

Ultimately, I modified the Dockerfile to accept a build argument:

```
ARG NEXT_PUBLIC_API_URL=http://property.localhost
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
```

And passed this argument during the build process:

```
yamlCopynextapp:
  build:
    context: ../property_management_system_full_stack_app/frontend
    dockerfile: next.dockerfile
    args:
      - NEXT_PUBLIC_API_URL=http://property.localhost
```

This approach ensured that the correct URL was embedded in the JavaScript bundle during the build process.

### Challenge 5: Cross-Origin Resource Sharing (CORS)

After resolving the hardcoded URL issue, I encountered some CORS errors:
CopyAccess to XMLHttpRequest at 'http://property.localhost/api/repair/users' from origin 'http://172.18.0.5:3000' has been blocked by CORS policy
They occurred because the frontend was being accessed at its container's IP address and port (172.18.0.5:3000) rather than through Traefik at property.localhost. Modern browsers implement a security feature that prevents web pages from making requests to different domains than the one they were loaded from, unless the server explicitly allows it.
We addressed this by:

I had to ensure that both frontend and backend were accessed through Traefik using the same domain
* I added appropriate CORS headers to the Go backend
* Configured Traefik to add CORS headers through middleware

```
yamlCopy- "traefik.http.middlewares.cors.headers.accessControlAllowOriginList=*"
- "traefik.http.middlewares.cors.headers.accessControlAllowMethods=GET,POST,PUT,DELETE,OPTIONS"
- "traefik.http.middlewares.cors.headers.accessControlAllowHeaders=Content-Type,Authorization"
- "traefik.http.routers.goapp.middlewares=cors@docker"
```

![alt text](<assets/Screenshot from 2025-03-31 16-32-15.png>)



## Final thoughts
With this configuration, all services ran harmoniously, with Traefik correctly routing requests to the appropriate applications based on the domain name. Both the NASA Space App and Property Management System were accessible through their respective domains.

![alt text](<assets/Screenshot from 2025-03-31 16-31-27 copy.png>)
