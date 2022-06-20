
<div align="center">

<!-- [![Typing SVG](https://readme-typing-svg.herokuapp.com?font=Major+Mono+Display&size=64&color=C20000&center=true&vCenter=true&height=100&lines=Klyntar)](https://git.io/typing-svg) -->
[![Typing SVG](https://readme-typing-svg.herokuapp.com?font=Major+Mono+Display&size=100&color=C20000&center=true&vCenter=true&width=500&height=200&lines=Klyntar)](https://git.io/typing-svg)

# 

</div>

## 📖 Content

- [Intro](#intro)
- [WhoAmI](#who_am_i)
- [How to build](#build)
- [Running kNULL](#knull)
- [Running AntiVenom(testnet)](#testnet)
- [Mutations](#mutations)
- [Contributions](#contrib)
- [Links](#links)

<br/><br/>

<div name="short_info"></div>

## ⚡ Intro 
<br/>

# <b>KLYNTAR</b> - symbiotic blockchain platform which takes the best from other projects, add new cool features and breaks into the industry

Working on KLYNTAR, we've been trying to make a project so powerful to wonder you as in your 8 y.o when you've got to know Santa doesn't exsist 🎅. This project isn't another shitcoin, 10<sup>th</sup> generation of memecoins, scam NFT project or so on. We want to resurrect the time of useful projects by creating cool stuff for our industry like <b>Unobtanium</b>, <b>KLYNTAR Services</b>, <b>Hivemind</b>, <b>symbiotes</b> and much more!

<br/>
<div align="center">

# We're geeks. We love crypto

</div>

<br/>

## This project can involve literally everyone:

- Developers will find here abilites to create decentralized services on any language they want and using latest & most reliable technologies. Our powerful community will devolope plugins to customize your infrastructure and improve workflows, create best practises, will work on our Cryptoland, improve security of runners & containers by adding cybersec stuff and so on! 
- Enterprise players will have an ability to build & control clusters of nodes,runners and run symbiotes
- Resources owners can use probably the most advanced staking system using <b>Unobtanium</b> - a KLYNTAR unified resource which includes your mined Bitcoin blocks, combination of tokens on Avalanche, validators place on Polkadot and so on!
- Everyone who has server & laptop & any other machine will make our empire more powerful. The installation processes are minified to several commands in pre-build Docker images, so we also save your health & nervous system & time
- ...and...read our other docs 😀

<br/><br/>

<div name="build"></div>

## 🏗️ How to build

<br/>

<p>
As you've seen, KLYNTAR is in symbiotic relationship with other blockchains. By running different nodes of other projects, working with tools required by them, the most auful & irritating problem was problem with initial setup - misconfigs, old docs, semver mistakes, nightly versions and so on. That's why, we've prepared docker images to allow you to be sure that you'll 100% have succesful setup. Recommended to be used to run KLY nodes & clusters, Apollo and so on.It's for better experience not to force you to waste time for finding misconfigs, dependencies problems and so on. Build & run fast and let's start 🚀

### <b>NOTE</b>
We assume that you have Docker on the board. You can install Docker for Linux & Windows & Mac <a href="https://docs.docker.com/engine/install/">here</a>

```shell

klyntar@apollo:~# docker -v
Docker version 20.10.14, build a224086

```

<br/><br/>

### <b>Download the image</b>

We present you our first image <a href="https://hub.docker.com/repository/docker/klyntar/all_in_one" target="_blank" rel="noopener">klyntar/all_in_one</a>.

<br/><br/>
<img src="http://dockeri.co/image/klyntar/all_in_one">
<br/><br/>

This is universal image with preinstalled Node.js, Go , Python and some tools like <code>pnpm</code> , <code>node-gyp</code>, <code>git</code> and so on. This is the base layer for all our Dockerfiles(at least for core and Apollo). The aproximate compressed size is 606M. Also, in our repository <a href="https://github.com/KLYN74R/KlyntarBaseImage" target="_blank" rel="noopener">KlyntarBaseImages</a> you can find the sources of all base-layer Dockerfiles, so you can clone and build it yourself or find the bash build script and so through the process to install requirements to your host machine. But anyway,we recomend you to use containers.


<img src="https://user-images.githubusercontent.com/53381472/174490998-2041af0d-6cd5-4873-ad64-fa810cda02df.jpg"/>

```shell

docker pull klyntar/all_in_one@sha256:dff001a9cd3da6328c504b52ed8a5748c47d23219feae220930dac1c1981cfe7

```

<br/><br/>

### <b>Run container</b>

<p>We recomend you to make available for container several ports</p>

Honestly,you can choose another port,but use this as a good manner

- 7331 - mainnet/kNULL default port for initial symbiote kNull. It's reversed 1337 :)  
  
- 9691 - default Apollo UI server port  
  
- 11111 - local testnet(ANTIVENOM)

<br/><br/>

> <b>⚠ ATTENTION:</b>  
This setup is the most default & simple way. If you need,you can manually run container with more advanced steps e.g. by using volumes,set user and so on

<br/><br/>


```shell
docker run -dtp 7331:7331, 9691:9691 , 11111:11111 --name klyntar0 klyntar/all_in_one@sha256:dff001a9cd3da6328c504b52ed8a5748c47d23219feae220930dac1c1981cfe7
```

<br/><br/>

### <b>Final</b>

Go into container to root dir

```shell
docker exec -ti klyntar0 bash

# Inside container

cd ~

```

Clone KlyntarCore repository
```shell

git clone https://github.com/KLYN74R/KlyntarCore.git

cd KlyntarCore

```

Finally,run the only one command
```shell

pnpm run build

```


<!-- CHANGE -->
<!-- CHANGE -->
<!-- CHANGE -->
<!-- CHANGE -->
<div align="center">

  ## <b>Now take a rest and see the building process. It may take some minutes,but you're free from self-install tons of libs,dependencies and walking among dirs</b>

  <img src="https://i.pinimg.com/originals/d0/63/09/d063096ba4e07795c1bdf98572cb79a8.gif" style="height:200px;width:auto;">


<br/>

### The signs that build was succesful are messages to console like this
<br/>
  <!-- Change -->
  <img src="https://2131090630-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FphIHWZY173DpNXBbDjVg%2Fuploads%2FdewG1SQftz0ndvmG4fNa%2Fimage.png?alt=media&token=ad2710a7-0fd1-43cb-ad80-62e78badb989">

<br/>

### ...and this
<br/>
  <!-- Change -->
<img src="https://2131090630-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FphIHWZY173DpNXBbDjVg%2Fuploads%2FL3RavrjoA7nktQKFfV3i%2Fphoto_2022-06-04_11-55-04.jpg?alt=media&token=6363785e-a243-4f98-80ca-5ee83b97da87">
<br/>

### Now try to run. You should see the following
<br/>
  <!-- Change -->
<img src="https://user-images.githubusercontent.com/53381472/174460136-49cbf58b-fe08-4952-81b2-3b6e13d96444.jpg">
<br/>

</div>



<br/><br/>

<div name="modularity"></div>

## ⚙️ Modularity
<br/>
<p>

Working with different "hacking" tools,I've get the experience of so called 'best practises' of how to build real powerful tool. That's why, Apollo(as KLYNTAR) will be very modular. Just now,you have three ways to improve Apollo behaviour by loading modules to KLY_Modules, KLY_ServicesAPI and KLY_WorkflowsAPI

<br/>

### <b>KLY_Modules</b>

Directory for your external modules. This might be extra useful commands. Might be written by you or any other 3rd party. Must contain 2 directories <b>cli</b>(contains everything for commands in CLI) and <b>ui</b>(directory with everything for UI in browser). Soon we'll make a tutorial of HOWTO write modules for Apollo.

Each directory-is typically Git repository to allow you to easily update different modules independently if you need and swap versions. Moreover,soon you'll also have an amazing ability to verify authors cryptographically - via code signing. By having hash of repository you can verify authority and be sure that code is original using different crypto features like multisig or post-quantum cryptography,social staking and so on. We describe it in <a href="https://mastering.klyntar.org/beginning/basic-security#additional-features">Basic Security</a> in our MasteringKlyntar book.

<br/><br/>

- CLI part

In CLI extra modules looks like ordinary commands. To allow your users to differ them, please, give them original prefix or make a single command with repository name and hide commands to subcommands 

- UI part

If module also has a UI part(which is often the case), then you'll have ability to visit:

```shell

http(s)://<your_interface>:<port>/modules

```

to find there the entry point to your module.

<br/>

#### <b>Summarizing this,your directories tree on these levels should look like this</b>


```
Apollo
│     
│   
└───KLY_Modules
│   │   
│   │
│   │   
│   └───init(default module,the entry point for the other)
│   │    │   
│   │    │───cli(directory for files to improve CLI)
│   │    │   │
│   │    │   └───init.js 
│   │    │
│   │    └───ui(directory for files to improve UI)
│   │        │
│   │        │───routes.js
│   │        │───templates(.ejs files)
│   │        │     └─...
│   │        │───configs.json
│   │        └───...
│   │   
│   │
│   └───your_custom_module
│        │   
│        │───cli(directory for files to improve CLI)
│        │    │   
│        │    └───init.js
│        │
│        └───ui(directory for files to improve UI)
│            │
│            │───routes.js
│            │───templates(.ejs files)
│            │     └─...
│            │───configs.json
│            └───...
│
│
└───KLY_ServicesAPI
    └───...

```

To update the repository with module go to appropriate directory <b>KLY_Modules/<your_module></b> and pull changes

<br/><br/>

### <b>KLY_ServicesAPI</b>

<br/>

> <b>ServiceAPI</b> - directory with API repositories to interact with the scope of service runned on Klyntar. Imagine if all smart contracts on ETH will have a unique design in your wallet, separate page with all available features specific to contract. Since we have wider power, we also have so complicated way to improve abilities of your Apollo instance.

<br/>


The same principle works for the services API. Each subdirectory - it's a repository. To check available services API go to

```shell

http(s)://<your_interface>:<port>/services

```

<br/><br/>

### <b>KLY_WorkflowsAPI</b>

<br/>

> <b>WorkflowsAPI</b> - directory with API repositories to interact with symbiotes on Klyntar. Insofar as they can use different workflows(thanksfully to <a href="https://mastering.klyntar.org/beginning/mutations">Mutations principle</a>),we need to make possible to use appropriate algorithms,build right events to send to symbiotes and use other specific features like traffic over TOR or threshold signatures. Imagine if you'll have ability to control your Bitcoin, Solana, Avalanche, Cosmos assets(native coins,tokens,etc.), execute smart contracts, make delegations using only one instrument. Yes,this is what Apollo do.

<br/>

The same principle as for services API. Each subdirectory - it's a repository in this directory. To check your symbiotes and how to interact with them go to

```shell

http(s)://<your_interface>:<port>/symbiotes

```


<br/><br/>

<div name="advice"></div>

## 🤓 Advice
<br/>
<p>
Follow us to get the news & updates ASAP. Discuss, share ideas, advices, help newbies to make our community more powerful.We're happy to involve new members to KLY community 😊
</p>

<br/>

<a href="https://www.reddit.com/r/KLYN74R/">  
  <img src="https://img.shields.io/badge/Reddit-FF4500?style=for-the-badge&logo=reddit&logoColor=white"/>
</a>
<a href="https://twitter.com/KLYN74R">
  <img src="https://img.shields.io/badge/Twitter-1DA1F2?style=for-the-badge&logo=twitter&logoColor=white"/>
</a>
<a href="https://klyntar.medium.com/">
  <img src="https://img.shields.io/badge/Medium-12100E?style=for-the-badge&logo=medium&logoColor=white"/>
</a>
<a href="https://www.tiktok.com/@klyn74r">
  <img src="https://img.shields.io/badge/TikTok-000000?style=for-the-badge&logo=tiktok&logoColor=white"/>
</a>

<br/>

<a href="https://www.instagram.com/klyn74r/">
  <img src="https://img.shields.io/badge/Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white"/>
</a>
  <a href="https://www.pinterest.com/klyn74r">
  <img src="https://img.shields.io/badge/Pinterest-%23E60023.svg?&style=for-the-badge&logo=Pinterest&logoColor=white"/>
</a>
  <a href="https://dev.to/klyntar">
  <img src="https://img.shields.io/badge/dev.to-0A0A0A?style=for-the-badge&logo=devdotto&logoColor=white"/>
</a>
<a href="https://github.com/KLYN74R">
  <img src="https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white"/>
</a>

<br/>

<a href="https://t.me/KLYN74R">
  <img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white"/>
</a>
<a href="https://discord.gg/f7e7fCp97r">
  <img src="https://img.shields.io/badge/Discord-7289DA?style=for-the-badge&logo=discord&logoColor=white"/>
</a>
<a href="http://klyntar66kjwhyirucco6sjgyp2f7lfznelzgpjcp6oha2olzb4rlead.onion">
  <img src="https://img.shields.io/badge/Tor%20site-330F63?style=for-the-badge&logoColor=white"/>
</a>
<a href="https://www.youtube.com/channel/UC3TiyK40an6rQlf3BarMDoQ">
  <img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white"/>
</a>

<br/>

<a href="https://www.facebook.com/KLYN74R/">
  <img src="https://img.shields.io/badge/Facebook-1877F2?style=for-the-badge&logo=facebook&logoColor=white"/>
</a>
<a href="https://gitlab.com/KLYNTAR">
  <img src="https://img.shields.io/badge/GitLab-330F63?style=for-the-badge&logo=gitlab&logoColor=white"/>
</a>
<a href="https://klyn74r.tumblr.com/">
  <img src="https://img.shields.io/badge/Tumblr-%2336465D.svg?&style=for-the-badge&logo=Tumblr&logoColor=white"/>
</a>
<a href="">
  <img src="https://img.shields.io/badge/Stack_Overflow-FE7A16?style=for-the-badge&logo=stack-overflow&logoColor=white"/>
</a>

<br/><br/>


<div name="docs"></div>

## 📚Docs

Read the docs here to find out more

<br/>

<a href="https://mastering.klyntar.org">🇬🇧 <img src="https://img.shields.io/badge/Gitbook-000000?style=for-the-badge&logo=gitbook&logoColor=white"></a><br/>
<a href="https://ru.mastering.klyntar.org">🇷🇺 <img src="https://img.shields.io/badge/Gitbook-000000?style=for-the-badge&logo=gitbook&logoColor=white"></a>