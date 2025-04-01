# Overview

I decided to set up a multi-application container environment using Traefik as a reverse proxy in order to have some alternative to AWS.
I encountered several challenges along the way and this document chronicles my process: from initial configuration attempts to the final working solution.

## Initial Setup: The Applications

I began with two distinct applications that needed to coexist and be easily accessible:

- **Dead Space Exploration App - A Node.js/Express backend with React frontend and MongoDB database** - A simple Space App that uses some outdated SpaceX Api from github.

- **Property Management System - A Go backend with Next.js frontend and PostgreSQL database** - A Property Management App that tracks the financial reserve for property repairs.

My goal was to use Traefik as a reverse proxy to route traffic to these applications based on domain names:

* (https://majortomtogroundcontrol.duckdns.org/) 
* (https://propertyapp.duckdns.org/) 

### Challenge 1: Choosing the Right Reverse Proxy
Initially, I attempted to use Envoy Proxy for this task. While it offers some nice features for microservice architectures, I quickly discovered that I can't deal with verbose YAML configuration and lack of automatic service discovery so soon after setting up my property app infrastructure - https://github.com/TankEngine-ish/property_management_system_infrastructure

After careful consideration, I pivoted to Traefik, which offers:

Automatic service discovery through Docker labels and built-in dashboard for monitoring and troubleshooting.
Look at how nice and clean it is: 
![alt text](<assets/Screenshot from 2025-03-31 16-31-27.png>)


### Challenge 2: Hardcoded API URL in the Next.js Application
Perhaps the most annoying issue was me finding out that API requests from the Property Management frontend were consistently attempting to reach the stupidly hardcoded AWS IP address.
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

This approach ensured that the correct URL was embedded in the JavaScript bundle during the build process. **This was before I set-up the DNS routes.**

### Challenge 5: Cross-Origin Resource Sharing (CORS)

After resolving the hardcoded URL issue, I encountered some CORS errors such as:
```
CopyAccess to XMLHttpRequest at 'http://property.localhost/api/repair/users' from origin 'http://172.18.0.5:3000' has been blocked by CORS policy
```
**Again, this issue happened before I set-up the DNS.**
These errors occurred because the frontend was being accessed at its container's IP address and port rather than through Traefik at property.localhost. 
I addressed this by:

* Adding appropriate CORS headers to the Go backend
* Configured Traefik to add CORS headers through middleware

```
yamlCopy- "traefik.http.middlewares.cors.headers.accessControlAllowOriginList=*"
- "traefik.http.middlewares.cors.headers.accessControlAllowMethods=GET,POST,PUT,DELETE,OPTIONS"
- "traefik.http.middlewares.cors.headers.accessControlAllowHeaders=Content-Type,Authorization"
- "traefik.http.routers.goapp.middlewares=cors@docker"
```

![alt text](<assets/Screenshot from 2025-03-31 16-32-15.png>)


## A Health Check Script in JS

What this monitoring.js script in the repository does is it:

- Checks the health of my Traefik dashboard and applications by making HTTP requests
- Verifies SSL certificate expiration dates
- Monitors response times and alerts if they exceed thresholds
- Checks the status of my Docker containers
- Generates alerts for any issues detected
- Displays colorized output in the console like this: 

![alt text](<assets/Screenshot from 2025-04-01 14-09-54.png>)

I gotta be honest, the main reason I added this script is because I just didn't like not having a Language used star under my github's repository name. Now I have Javascript which is better than nothing.

P.S. Make sure you have Node.js installed on your system and then you run the script with:

```
node monitoring.js
```

## Final thoughts
With this configuration, all services ran harmoniously, with Traefik correctly routing requests to the appropriate applications based on the domain name. Both the Dead Space App and Property Management System were accessible through their respective domains.

![alt text](<assets/Screenshot from 2025-03-31 16-32-22.png>)
